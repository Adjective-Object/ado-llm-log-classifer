import { type Timeline, type TimelineRecord, IssueType, TaskResult } from "azure-devops-node-api/interfaces/BuildInterfaces.js";

export function getLeafFailureRecords(
    timeline: Timeline,
): number[] {
    let records = timeline.records ?? [];
    // avoid including parent records in the frontier
    let allParentTimelineEntryRecords = new Set();
    let allTimelineEntryResults = new Map<string, TaskResult>()
    for (let record of records) {
        if (record.parentId != null) {
            allParentTimelineEntryRecords.add(record.parentId);
        }
        if (record.id && record.result) {
            allTimelineEntryResults.set(record.id, record.result);
        }
    }
    type RecordTuple = [TimelineRecord, number];
    let leafFailedRecordIdxes = (timeline.records ?? [])
        .map((record, i) => [record, i] as RecordTuple)
        .filter(([record,]) =>
            // only report leaf failures, becasue we reconstruct the issue chain
            // for any other failing issues
            !allParentTimelineEntryRecords.has(record.id) &&
            (
                // The task itself failed
                record.result == TaskResult.Failed ||
                // or, the task was canceled and the parent either failed or was itself cancelled:
                // this timed out and we should consider it a "leaf" failure
                record.result == TaskResult.Canceled &&
                record.parentId &&
                allTimelineEntryResults.get(record.parentId) == TaskResult.Failed
            ))
        .map(([, idx]) => idx)
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
    id: number
    failingIssueMessages: string[];
    logId?: number;
}

function getParentFailingIssueMessages(
    timeline: Timeline,
    index: number,
): string[] {
    let records = timeline.records ?? [];
    let issueMessages: string[] = [];
    let head: TimelineRecord | null = records[index];
    while (head != null) {
        if (head.issues) {
            for (let issue of head.issues) {
                if (issue.type == IssueType.Error && issue.message) {
                    issueMessages.push(issue.message);
                }
            }
        }
        // workaround for typescript not tracking inferred types through callbacks
        let h: TimelineRecord = head;
        head = records.find((record) => record.id == h.parentId) ?? null;
    }
    return issueMessages;
}


export function getLeafFailedJobs(
    timeline: Timeline,
): FailedJob[] {
    let records = timeline.records ?? [];
    let leafFailedRecordIdxes = getLeafFailureRecords(timeline);
    return leafFailedRecordIdxes.map((i) => {
        let record = records[i];
        let logId = record.log?.id;
        return {
            id: i,
            failingIssueMessages: getParentFailingIssueMessages(timeline, i),
            logId: logId,
        };
    });
}