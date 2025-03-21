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
}
);