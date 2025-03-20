import { type Issue, type Timeline, type TimelineRecord, TaskResult } from "azure-devops-node-api/interfaces/BuildInterfaces.js";

export function getLeafFailureRecords(
    timeline: Timeline,
): number[] {
    let records = timeline.records ?? [];
    // avoid including parent records in the frontier
    let allParentTimelineEntryRecords = new Set();
    for (let record of records) {
        if (record.parentId != null) {
            allParentTimelineEntryRecords.add(record.parentId);
        }
    }
    type RecordTuple = [TimelineRecord, number];
    let leafFailedRecordIdxes = (timeline.records ?? [])
        .map((record, i) => [record, i] as RecordTuple)
        .filter(([record, ]) => record.result == TaskResult.Failed && !allParentTimelineEntryRecords.has(record.id))
        .map(([, idx]) => idx)
        console.log(`leafFailedRecordIdxes: ${leafFailedRecordIdxes}`);
    return leafFailedRecordIdxes
}


export function getLeafFailedLogIds(
    timeline: Timeline,
): number[] {
    let records = timeline.records ?? [];
    let leafLogIds = getLeafFailureRecords(timeline).map((i) => {
        if (i > records.length) {
            return null;
        }
        let record = records[i];
        return record.log?.id
    }).filter((logId) => logId != null);
    return leafLogIds
}

export type FailedJob = {
    parentIssues: Issue[];
    logId?: number;
}

function getParentIssues(
    timeline: Timeline,
    index: number,
): Issue[] {
    let records = timeline.records ?? [];
    let issues: Issue[] = [];
    let head = records[index];
    while (head != null) {
        if (head.issues) {
            for (let issue of head.issues) {
                issues.push(issue);
            }
        }
    }
    return issues;
}


export function getLeafFailedJobs(
    timeline: Timeline,
): FailedJob[] {
    let records = timeline.records ?? [];
    let leafFailedRecordIdxes = getLeafFailureRecords(timeline);
    return leafFailedRecordIdxes.map((i) => {
        let record = records[i];
        let logId = record.log?.id;
        let parentIssues = getParentIssues(timeline, i);
        return {
            parentIssues: parentIssues,
            logId: logId,
        };
    });
}