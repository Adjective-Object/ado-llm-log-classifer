import color from 'cli-color';
import { JobReference } from 'cluster.mjs';
import { EmbedDir, LogDir } from 'LogDir.mjs';
import { FailedJob } from 'timeline-helpers.mjs';

export function printBuildInfo(
    logDir: LogDir,
    embedDir: EmbedDir,
    jobRef: JobReference,
    jobRaw: FailedJob,
) {
    if (jobRaw.issues?.length && jobRaw.issues.length > 0) {
        console.log(`\n  ${color.bold("Issues")}:\n${jobRaw.issues.map(issue => `    - ${issue.trim()}`).join("\n")}`);
    }
    const logPath = (jobRaw.logId) ? logDir.getPathForBuildLog(jobRef.buildId, jobRaw.logId) : "<none>";
    console.log(`\n  ${color.bold("Log")}: ${logPath}`);
    if (jobRaw.logId) {
        let logCleanPath = embedDir.getCleanLogForBuildJob(jobRef.buildId, jobRef.jobId);
        console.log(`  ${color.bold("Log (cleaned)")}: ${logCleanPath}`);
    }
}