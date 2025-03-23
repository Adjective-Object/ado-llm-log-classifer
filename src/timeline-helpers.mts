import { type Timeline, type TimelineRecord, IssueType, TaskResult } from "azure-devops-node-api/interfaces/BuildInterfaces.js";

class TimelineGraph {
    public idToTaskIdx: Map<string, number> = new Map<string, number>();

    constructor(public records: TimelineRecord[]) {
        this.records = records;
        this.idToTaskIdx = new Map<string, number>()
        for (let idx = 0; idx < records.length; idx++) {
            let rId = records[idx].id;
            if (rId == null) {
                continue;
            }
            this.idToTaskIdx.set(rId, idx);
        }
    }

    lookupTask(id: string | undefined): TimelineRecord | null {
        if (id == null) {
            return null;
        }
        let idx = this.idToTaskIdx.get(id);
        if (idx == null) {
            return null;
        }
        return this.records[idx];
    }

    findLeaves(
        subsetIds: Set<string>,
    ): Set<string> {
        let records = this.records.filter((record) => record.id && subsetIds.has(record.id));

        // avoid including parent records in the frontier
        let nonLeafRecords = new Set();
        for (let record of records) {
            if (record.parentId != null) {
                nonLeafRecords.add(record.parentId);
            }
        }
        let leafRecords = new Set<string>();
        for (let record of records) {
            if (record.id && !nonLeafRecords.has(record.id)) {
                leafRecords.add(record.id);
            }
        }
        return leafRecords
    }
}

function isFailure(record: TimelineRecord): boolean {
    return record.result == TaskResult.Failed ||
        record.result == TaskResult.Canceled ||
        (record.issues?.some((issue) => issue.type == IssueType.Error) ?? false)
}

export function getLeafFailureRecords(
    timeline: Timeline,
): number[] {
    if (!timeline.records) {
        return [];
    }
    let records = timeline.records;
    let graph = new TimelineGraph(records);

    let allTaskIds = new Set(
        records.map((record) => record.id)
            .filter((id): id is string => typeof id == "string"));

    // find the subgraph that only contains non-succesful tasks
    // and their parents
    let failingSubtree = new Set<string>();
    for (let id of graph.findLeaves(allTaskIds)) {
        let head: string | null | undefined = id;
        let failureBranch = false;
        while (head && !failingSubtree.has(head)) {
            let timelineEntry = graph.lookupTask(head);
            if (timelineEntry == null || timelineEntry.id == null) {
                break;
            }
            failureBranch = failureBranch || isFailure(timelineEntry);
            if (failureBranch) {
                failingSubtree.add(timelineEntry.id);
            }
            head = timelineEntry.parentId;
        }
    }

    // Checks if the task failed is a cancellation failure
    // i.e. the task was cancelled, and is the child of a task that failed
    // or is itself a cancellation failure
    function isIndirectCancellationFailure(id: string | undefined) {
        let head: string | null | undefined = id;
        while (head) {
            let timelineEntry = graph.lookupTask(head);
            if (timelineEntry == null) {
                return false;
            }

            if (isFailure(timelineEntry)) {
                return true;
            } else if (timelineEntry.result == TaskResult.Canceled) {
                head = timelineEntry.parentId;
            } else {
                return false
            }
        }
    }

    let failingLeaves = Array.from(graph.findLeaves(failingSubtree)).filter((id) => {
        let record = graph.lookupTask(id);
        if (record == null) {
            return false;
        }
        // check if the task is a cancellation failure or is itself a failure
        if (isFailure(record) || isIndirectCancellationFailure(record.id)) {
            return true;
        }
        return false;
    });

    // return the indexes of the failing leaves
    let failingLeavesIdx = failingLeaves.map((id) => {
        let idx = graph.idToTaskIdx.get(id);
        if (idx == null) {
            return -1;
        }
        return idx;
    }).filter((idx) => idx >= 0);
    return failingLeavesIdx;
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
    issues: string[];
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
                    if (head.name) {
                        issueMessages.push(head.name + "::" + issue.message);
                    } else {
                        issueMessages.push(issue.message);
                    }
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
            issues: getParentFailingIssueMessages(timeline, i),
            logId: logId,
        };
    });
}