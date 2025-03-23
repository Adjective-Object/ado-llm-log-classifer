import * as fs from 'node:fs';
import * as stream from "node:stream"
import * as path from 'node:path';
import * as hub from "@huggingface/hub";
import { BuildResult } from 'azure-devops-node-api/interfaces/BuildInterfaces.js';
import { parseArgs, type ArgDescriptors } from './args.mjs';
import ora from 'ora';
import { fileExists, mkdirp } from './fs-helpers.mjs';
import { getLlama, LlamaGpuType } from "node-llama-cpp";
import { EmbedDir, LogDir } from './LogDir.mjs';
import { getLeafFailedJobs } from './timeline-helpers.mjs';
import { catchOra, withOra } from './ora-helpers.mjs';
import {
    embedChunkedTokens,
    MemoizedEmbedder,
    tokenizeAndChunkText,
    type EmbeddedJobFailure
} from './embedding.mjs';
import color from 'cli-color';
import { filesize } from 'filesize';
import { cleanAdoLogLine } from './clean-ado-log.js';

type Args = {
    help?: string;
    hfToken: string;
    hfEmbeddingModel: string;
    outBaseDir: string;
    gpu: string;
};
const argDescriptors: ArgDescriptors<Args> = {
    help: {
        shortName: 'h',
        helpDescription: 'Print this help message',
    },
    hfToken: {
        shortName: 'p',
        helpDescription: 'The hugging face PAT token',
        missingPrompt: 'HuggingFace PAT Token',
    },
    // hfSummaryModel: {
    //     shortName: 'S',
    //     helpDescription: 'The model to use for summarization, formatted as "repoName:pathInRepo"',
    //     missingPrompt: 'HuggingFace Summary Model (repo:pathInRepo)',
    // },
    hfEmbeddingModel: {
        shortName: 'E',
        helpDescription: 'The model to use for embedding, formatted as "repoName:pathInRepo"',
        missingPrompt: 'HuggingFace Embedding Model (repo:pathInRepo)',
    },
    outBaseDir: {
        shortName: 'o',
        helpDescription: 'The base directory to save the output files',
        default: "./out",
    },
    gpu: {
        shortName: 'g',
        helpDescription: 'node-llama-cpp GPU mode (auto,metal,cuda,vulkan,false)',
        default: "auto",
    }
};


function sanitizeFileName(name: string): string {
    return name.replace(/[^a-zA-Z0-9\.]/g, '-');
}

async function runDownload(
    download: Response | null,
    targetPath: string,
): Promise<void> {
    if (!download) {
        throw new Error(`Could not download`);
    }
    if (!download.ok) {
        throw new Error(`download response is not OK (status:${download.status})`);
    }
    if (!download.body) {
        throw new Error(`download response body is empty`);
    }

    // write the download to a temporary file
    let tempDownload = targetPath + '.part';
    // create a writable stream to the temporary file
    let fileStream = fs.createWriteStream(tempDownload);
    stream.Readable.fromWeb(
        // workaround for issue in @types/node, see https://github.com/microsoft/TypeScript/issues/61390
        download.body as any
    ).pipe(fileStream);
    await new Promise<void>((resolve, reject) => {
        fileStream.on('finish', resolve);
        fileStream.on('error', reject);
    });

    // move the part file to the final location
    await fs.promises.rename(tempDownload, targetPath);

}

async function downloadModel(
    repoName: string,
    pathInRepo: string,
    outBase: string,
    hfToken: string,
): Promise<string> {
    let modelsFolder = path.join(outBase, 'models');
    await mkdirp(modelsFolder);
    let modelDlPath = path.join(modelsFolder, sanitizeFileName(`${repoName}__${pathInRepo}`));
    // check if the model already exists in the models folder
    if (await fileExists(modelDlPath)) {
        console.log(`Pre-downloaded model found at ${modelDlPath}, using existing file`);
        return modelDlPath;
    }

    console.log(`looking up repo ${repoName}`);
    const repo: hub.RepoDesignation = { type: "model", name: repoName };
    await hub.checkRepoAccess({ repo, accessToken: hfToken });

    console.log(`handshaking with huggingface to start download of ${repoName}:${pathInRepo}`);
    let download = await hub.downloadFile({
        repo: repo,
        path: pathInRepo,
        accessToken: hfToken,
    });
    const spinner = ora(`downloading ${repoName}:${pathInRepo}`).start();
    await runDownload(download, modelDlPath).then(
        () => spinner.succeed(`downloaded ${repoName}:${pathInRepo}`),
        (err) => {
            spinner.fail(`failed to download ${repoName}:${pathInRepo}`)
            throw err;
        }
    );
    return modelDlPath;
}

function parseModelReference(reference: string): { repoName: string, pathInRepo: string } {
    let parts = reference.split(':');
    if (parts.length !== 2) {
        throw new Error(`Invalid model reference: ${reference}`);
    }
    return {
        repoName: parts[0],
        pathInRepo: parts[1],
    };
}

function validateGpu(gpu: string): 'auto' | LlamaGpuType {
    switch (gpu) {
        case 'metal':
        case 'cuda':
        case 'vulkan':
        case 'auto':
            return gpu;
        case 'false':
            return false;
        default:
            throw new Error(`Invalid GPU type: ${gpu}`);
    }
}

async function main() {
    const args = await parseArgs(
        "embed-logs",
        argDescriptors,
        (args: Partial<Args>) => path.join(args.outBaseDir ?? "out", "embed-logs-args.json"),
    );
    if (args == null) {
        return;
    }

    console.log("Arguments:\n" + Object.entries(args).map(([k, v]) => `  ${k}: ${v}`).join("\n"));
    let gpu = validateGpu(args.gpu);

    // download the embedding model
    let { repoName: embeddingRepo, pathInRepo: embeddingPath } = parseModelReference(args.hfEmbeddingModel);
    let embeddingModelPath = await downloadModel(embeddingRepo, embeddingPath, args.outBaseDir, args.hfToken);
    console.log(`Downloaded embedding model to ${embeddingModelPath}`);

    // Load the embedding model in to llama-cpp
    let llama = await withOra(getLlama({
        gpu: gpu,
    }), 'loading llama-cpp');
    console.log(`Loaded llama-cpp. gpu: ${llama.gpu ? 'yes' : 'no'}, max-threads: ${llama.maxThreads}`);

    let model = await withOra(llama.loadModel({
        modelPath: embeddingModelPath,
    }), 'loading embedding model');

    // compute embeddings for each failed build
    let spinner = ora('embedding builds..');
    let logDir = new LogDir(args.outBaseDir);
    let buildIds = await logDir.listBuilds();
    let embedDir = new EmbedDir(args.outBaseDir);

    let skippedSuccessfulCt = 0;
    let skippedPartialCt = 0;
    let embeddedBuildCt = 0;
    let skippedAlreadyBuildCt = 0;
    let embeddedJobCt = 0;
    let skippedAlreadyJobCt = 0;

    const embeddingContext = await model.createEmbeddingContext();
    // create a memoized embedder to avoid recomputing embeddings for the same text
    //
    // We do this because we expect issue messages to be repeated across builds, and we don't want to
    // re-embed the same text multiple times if we can avoid it.
    const issueEmbedder = new MemoizedEmbedder(embeddingContext);

    for (let [i, buildId] of buildIds.entries()) {
        let prefix = `(${i}/${buildIds.length}) [suc:${skippedSuccessfulCt} prt:${skippedPartialCt} cached:${skippedAlreadyBuildCt}b/${skippedAlreadyJobCt}j new:${embeddedBuildCt}b/${embeddedJobCt}j]`
        spinner.text = prefix + ": loading build..";

        let build = await logDir.loadBuild(buildId);
        if (build == null) {
            skippedPartialCt++;
            continue;
        }
        if (build.result != BuildResult.Failed) {
            // silently skip builds that haven't been downloaded or were succesful
            skippedSuccessfulCt++;
            continue
        };
        spinner.text = prefix + `: embedding build ${buildId}`;
        let timeline = await logDir.loadTimeline(buildId);
        if (timeline == null) {
            spinner.stopAndPersist({ text: `build id:${buildId} - skipped (timeline missing)`, symbol: color.yellow('⏭') });
            // replace the spinner
            spinner = ora(spinner.text).start();
            skippedPartialCt++;
            continue;
        }

        let failedJobs = getLeafFailedJobs(timeline);
        if (failedJobs.length == 0) {
            spinner.stopAndPersist({ text: `build id:${buildId} - skipped (no failed leaf jobs)`, symbol: color.yellow('⏭') });
            // replace the spinner
            spinner = ora(spinner.text).start();
            skippedSuccessfulCt++;
            continue;
        }

        let anyEmbed = false
        for (let job of failedJobs) {
            // check if the job has already been embedded
            if (await embedDir.hasBuildJobEmbeddings(buildId, job.id)) {
                skippedAlreadyJobCt++;
                continue;
            }
            anyEmbed = true;

            // save the inputs to a logfile
            spinner.text = prefix + `: build ${buildId} job:${job.id}/log:${job.logId} - saving raw inputs`;
            // hack: add the log path to the job object for debugging
            let extJob = {
                ...job,
            }
            if (job.logId) {
                let logPath = await logDir.getPathForBuildLog(buildId, job.logId);
                (extJob as any).logPath = logPath;
            }
            embedDir.saveBuildJobRaw(buildId, extJob).catch(catchOra(spinner));

            spinner.text = prefix + `: build ${buildId} job:${job.id}/log:${job.logId} - ${job.issues.length} issues`;
            let issueEmbeddings = await Promise.all(
                job.issues.map((msg) => issueEmbedder.embed(msg))
            ).catch(catchOra(spinner));
            let processedLog = await (job.logId ? logDir.loadLogLines(buildId, job.logId, cleanAdoLogLine).then(
                async (cleanedLog) => {
                    if (!cleanedLog) {
                        return undefined
                    }
                    let chunks = tokenizeAndChunkText(cleanedLog, embeddingContext);
                    spinner.text = prefix + `: embedding build ${buildId} job:${job.id}/log:${job.logId} (${chunks.length} chunks, ${filesize(cleanedLog.length)})`;
                    return {
                        embedding: await embedChunkedTokens(chunks, embeddingContext),
                        cleanedLog
                    }
                }
            ) : null)?.catch(catchOra(spinner));
            let logEmbedding = processedLog?.embedding;
            let cleanedLog = processedLog?.cleanedLog;

            spinner.text = prefix + `: embedding build ${buildId} job:${job.id}/log:${job.logId} -- saving`;

            // save the embeddings
            let toSave: EmbeddedJobFailure = {
                buildId: buildId,
                jobId: job.id,
                issues: issueEmbeddings,
            };
            if (logEmbedding) {
                toSave.log = logEmbedding;
            }
            await embedDir.saveBuildJobEmbeddings(buildId, toSave, cleanedLog).catch(catchOra(spinner));
            embeddedJobCt++;
        }
        if (anyEmbed) {
            embeddedBuildCt++;
            spinner.succeed(`build id:${buildId} - done`);
            spinner = ora(prefix).start();
        } else {
            spinner.stopAndPersist({ text: `build id:${buildId} - skipped (all jobs already embedded)`, symbol: color.yellow('⏭') });
            spinner = ora(prefix).start();
        }
    }

    spinner.succeed(`finished embedding builds (${embeddedBuildCt}/${buildIds.length} builds)`);

    // embed reference logs

}

main().catch((err) => {
    console.error(err);
    if (err instanceof Error) {
        console.error(err.stack);
        console.error(err.cause);
    }
    process.exit(1);
});