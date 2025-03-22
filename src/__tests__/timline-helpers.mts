import { BuildResult, IssueType, TimelineRecordState, type Timeline } from "azure-devops-node-api/interfaces/BuildInterfaces.js";
import { TaskResult } from "azure-devops-node-api/interfaces/BuildInterfaces.js";
import { getLeafFailureRecords } from "../timeline-helpers.mjs";

describe("getLeafFailureRecords", () => {
    it("should return the correct leaf failure record indexes", () => {
        let timeline: Timeline = {
            records: [
                { id: "root", result: TaskResult.Failed },
                { id: "cancelled-task", result: TaskResult.Canceled, parentId: "root" },
                { id: "failed-task", result: TaskResult.Failed, parentId: "root" },
            ]
        };
        let result = getLeafFailureRecords(timeline);
        expect(result.sort()).toEqual([1, 2]);
    });

    it("finds cancelled jobs from a parent job timeout", () => {
        const exampleTimeline: Timeline = {
            records: [
                {
                    "id": "id-0",
                    "parentId": "id-1",
                    "type": "Task",
                    "name": "build task",
                    "state": 2,
                    "result": 3,
                },
                {
                    "id": "id-1",
                    "parentId": "id-2",
                    "type": "Job",
                    "name": "Build",
                    "state": 2,
                    "result": 3,
                },
                {
                    "id": "id-2",
                    "parentId": "id-3",
                    "type": "Phase",
                    "name": "Build",
                    "state": 2,
                    "result": 2,
                },
                {
                    "previousAttempts": [],
                    "id": "id-3",
                    "type": "Stage",
                    "name": "Main",
                    "state": 2,
                    "result": 2,
                },
            ]
        }

        const result = getLeafFailureRecords(exampleTimeline as Timeline);
        expect(result).toEqual([
            0,
        ]);
    });

    it("finds job that time out when all child jobs succeed", () => {
        const exampleTimeline: Timeline = {
            records: [
                {
                    "id": "id-0",
                    "parentId": "id-1",
                    "type": "Task",
                    "name": "build task that succeeded!",
                    "state": TimelineRecordState.Completed,
                    "result": TaskResult.Succeeded,
                },
                {
                    "id": "id-1",
                    "parentId": "id-2",
                    "type": "Job",
                    "name": "Build",
                    "state": TimelineRecordState.Completed,
                    "result": TaskResult.Succeeded,
                },
                {
                    "id": "id-2",
                    "parentId": "root",
                    "type": "Phase",
                    "name": "Build",
                    "state": TimelineRecordState.Completed,
                    "result": TaskResult.Succeeded,
                },
                {
                    "previousAttempts": [],
                    "id": "root",
                    "type": "Stage",
                    "name": "Main",
                    "state": TimelineRecordState.Completed,
                    "result": TaskResult.Succeeded,
                    "issues": [
                        {
                            "type": IssueType.Error,
                            "message": "Job timed out",
                        }
                    ]
                },
            ]
        }

        const result = getLeafFailureRecords(exampleTimeline as Timeline);
        expect(result).toEqual([
            3,
        ]);
    });


    it("does not find timeout jobs when they have a cancelled child", () => {
        const exampleTimeline: Timeline = {
            records: [
                {
                    "id": "id-0",
                    "parentId": "id-1",
                    "type": "Task",
                    "name": "build task that succeeded!",
                    "state": TimelineRecordState.Completed,
                    "result": TaskResult.Succeeded,
                },
                {
                    "id": "id-1",
                    "parentId": "id-2",
                    "type": "Job",
                    "name": "Build",
                    "state": TimelineRecordState.Completed,
                    "result": TaskResult.Canceled,
                },
                {
                    "id": "id-2",
                    "parentId": "root",
                    "type": "Phase",
                    "name": "Build",
                    "state": TimelineRecordState.Completed,
                    "result": TaskResult.Canceled,
                },
                {
                    "id": "otherbranch",
                    "parentId": "root",
                    "type": "Phase",
                    "name": "Build",
                    "state": TimelineRecordState.Completed,
                    "result": TaskResult.Succeeded,
                },
                {
                    "previousAttempts": [],
                    "id": "root",
                    "type": "Stage",
                    "name": "Main",
                    "state": TimelineRecordState.Completed,
                    "result": TaskResult.Succeeded,
                    "issues": [
                        {
                            "type": IssueType.Error,
                            "message": "Job timed out",
                        }
                    ]
                },
            ]
        }

        const result = getLeafFailureRecords(exampleTimeline as Timeline);
        expect(result).toEqual([
            1,
        ]);
    });
});