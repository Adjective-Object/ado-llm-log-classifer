import { type Timeline } from "azure-devops-node-api/interfaces/BuildInterfaces.js";
import { TaskResult } from "azure-devops-node-api/interfaces/BuildInterfaces.js";
import { getLeafFailureRecords } from "../timeline-helpers.mjs";

describe("getLeafFailureRecords", () => {
    it("should return the correct leaf failure record indexes", () => {
        let timeline: Timeline = {
            records: [
                { id: "root", result: TaskResult.Failed },
                { id: "2", result: TaskResult.Canceled, parentId: "root" },
                { id: "5", result: TaskResult.Failed, parentId: "root" },
            ]
        };
        let result = getLeafFailureRecords(timeline);
        expect(result.sort()).toEqual([1, 2]);
    });

    it("works on an example test case", () => {
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
                    "parentId": "id-3",
                    "type": "Job",
                    "name": "Build",
                    "state": 2,
                    "result": 3,
                },
                {
                    "id": "id-3",
                    "parentId": "id-4",
                    "type": "Phase",
                    "name": "Build",
                    "state": 2,
                    "result": 2,
                },
                {
                    "previousAttempts": [],
                    "id": "id-4",
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
});