import * as fs from 'node:fs';
import * as stream from "node:stream"
import * as path from 'node:path';
import * as hub from "@huggingface/hub";
import { parseArgs } from './args.mjs';
import ora from 'ora';
import { mkdirp } from './fs-helpers.mjs';
import { error } from 'node:console';

type Args = {
    help?: string;
    hfToken: string;
    hfSummaryModel: string;
    hfEmbeddingModel: string;
    outBaseDir: string;
};
const argDescriptors = {
    help: {
        shortName: 'h',
        helpDescription: 'Print this help message',
    },
    hfToken: {
        shortName: 'p',
        helpDescription: 'The hugging face PAT token',
        missingPrompt: 'HuggingFace PAT Token',
    },
    hfSummaryModel: {
        shortName: 'S',
        helpDescription: 'The model to use for summarization, formatted as "repoName:pathInRepo"',
        missingPrompt: 'HuggingFace Summary Model (repo:pathInRepo)',
    },
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
};

function sanitizeFileName(name: string): string {
    return name.replace(/[^a-zA-Z0-9\.]/g, '-');
}

function fileExists(filePath: string): Promise<boolean> {
    return fs.promises.stat(filePath).then(x => x.isFile()).catch(() => false)
}

async function runDownload(
    download: Response| null,
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
        () =>         spinner.succeed(`downloaded ${repoName}:${pathInRepo}`),
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

async function downloadModels(
    outDir: string,
    hfToken: string,
    hfSummaryModel: string,
    hfEmbeddingModel: string
): Promise<{ embeddingModel: String, summarizeModel: String }> {
    let { repoName: summaryRepo, pathInRepo: summaryPath } = parseModelReference(hfSummaryModel);
    let { repoName: embeddingRepo, pathInRepo: embeddingPath } = parseModelReference(hfEmbeddingModel);

    let summarizeModel = await downloadModel(summaryRepo, summaryPath, outDir, hfToken);
    let embeddingModel = await downloadModel(embeddingRepo, embeddingPath, outDir, hfToken);

    return { embeddingModel, summarizeModel };
}

async function main() {
    const args = await parseArgs(
        "classify-logs",
        argDescriptors,
        (args: Partial<Args>) => path.join(args.outBaseDir ?? "out", "classify-logs-args.json"),
    ) as Args;

    // download the models
    let { embeddingModel, summarizeModel } = await downloadModels(args.outBaseDir, args.hfToken, args.hfSummaryModel, args.hfEmbeddingModel);
    console.log(`Downloaded models to ${embeddingModel} and ${summarizeModel}`);

}

main().catch((err) => {
    console.error(err);
    if (err instanceof Error) {
        console.error(err.stack);
        console.error(err.cause);
    }
    process.exit(1);
});