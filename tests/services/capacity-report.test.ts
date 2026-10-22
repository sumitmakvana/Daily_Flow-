import { describe, it, expect } from "vitest";
import { buildMemberRows } from "@/services/capacity-report";

const CAP = 160;
const find = (rows: ReturnType<typeof buildMemberRows>, name: string) =>
  rows.find((r) => r.projectName === name);

describe("buildMemberRows (Member Capacity Breakdown)", () => {
  it("under capacity: leftover goes to Unused Capacity, never to Unassigned", () => {
    const rows = buildMemberRows("a", { TMS: 47.2, CoNexus: 36.6, Unassigned: 10 }, {}, CAP);
    expect(find(rows, "Unassigned")?.hours).toBe(10);
    expect(find(rows, "Unused Capacity")?.hours).toBe(66.2); // 160 - 93.8
    expect(find(rows, "Over Capacity")).toBeUndefined();
    const total = find(rows, "Total")!;
    expect(total.hours).toBe(93.8);
    expect(total.totalWorkingHours).toBe(CAP);
    expect(total.pctProject).toBe("58.6%"); // 93.8 / 160
  });

  it("exactly at capacity: no Unused and no Over rows, total 100%", () => {
    const rows = buildMemberRows("a", { TMS: 100, Operon: 60 }, {}, CAP);
    expect(find(rows, "Unused Capacity")).toBeUndefined();
    expect(find(rows, "Over Capacity")).toBeUndefined();
    expect(find(rows, "Total")).toMatchObject({ hours: 160, pctProject: "100%" });
  });

  it("dharmesh case: 81h real Unassigned is no longer inflated by filler", () => {
    const rows = buildMemberRows("d", { Operon: 4, TerraCognita: 52, Unassigned: 81, TMS: 4 }, {}, CAP);
    expect(find(rows, "Unassigned")).toMatchObject({ hours: 81, pctProject: "50.6%" });
    expect(find(rows, "Unused Capacity")?.hours).toBe(19);
    expect(find(rows, "Total")).toMatchObject({ hours: 141, pctProject: "88.1%" });
  });

  it("over capacity: excess shown separately, % not capped at 100", () => {
    const rows = buildMemberRows("d", { TMS: 100, Unassigned: 81 }, {}, CAP);
    expect(find(rows, "Over Capacity")).toMatchObject({ hours: 21, pctProject: "13.1%" });
    expect(find(rows, "Unused Capacity")).toBeUndefined();
    expect(find(rows, "Unassigned")?.hours).toBe(81); // actual hours never capped
    expect(find(rows, "Total")).toMatchObject({ hours: 181, pctProject: "113.1%" });
  });

  it("leave reduces available capacity for unused/over", () => {
    const under = buildMemberRows("l", { TMS: 100, Leave: 40 }, {}, CAP);
    expect(find(under, "Unused Capacity")?.hours).toBe(20);
    expect(find(under, "Leave")?.hours).toBe(40);
    expect(find(under, "Total")?.hours).toBe(100); // leave not part of logged
    expect(find(under, "Total")).toMatchObject({ leaveHours: 40, availableCapacity: 120, pctProject: "83.3%" });
    expect(find(under, "Unused Capacity")?.pctProject).toBe("16.7%"); // 20 / 120
    expect(find(under, "Leave")?.pctProject).toBe("25%"); // 40 / 160 (monthly capacity)

    const over = buildMemberRows("l", { TMS: 130, Leave: 40 }, {}, CAP);
    expect(find(over, "Over Capacity")?.hours).toBe(10); // 130 - (160-40)
    expect(find(over, "Unused Capacity")).toBeUndefined();
  });

  it("no data: whole capacity is Unused, nothing is Unassigned", () => {
    const rows = buildMemberRows("x", {}, {}, CAP);
    expect(find(rows, "Unassigned")).toBeUndefined();
    expect(find(rows, "Unused Capacity")?.hours).toBe(160);
    expect(find(rows, "Total")).toMatchObject({ hours: 0, pctProject: "0%" });
  });

  it("auto hours: per-project value and total, none on capacity rows", () => {
    const rows = buildMemberRows("a", { TMS: 50, Operon: 20 }, { TMS: 10, Operon: 5 }, CAP);
    expect(find(rows, "TMS")?.autoHours).toBe(10);
    expect(find(rows, "Total")?.autoHours).toBe(15);
    expect(find(rows, "Unused Capacity")?.autoHours).toBeUndefined();
  });

  it("spec example: 168h capacity, 24h leave, 153.5h logged", () => {
    const rows = buildMemberRows("e", { TMS: 100, Operon: 53.5, Leave: 24 }, {}, 168);
    const total = find(rows, "Total")!;
    expect(total).toMatchObject({
      hours: 153.5,
      totalWorkingHours: 168,
      leaveHours: 24,
      availableCapacity: 144,
      pctProject: "106.6%",
    });
    expect(find(rows, "Over Capacity")).toMatchObject({ hours: 9.5, pctProject: "6.6%" });
    expect(find(rows, "Unused Capacity")).toBeUndefined();
    expect(find(rows, "TMS")?.pctProject).toBe("69.4%"); // 100 / 144
  });

  it("zero leave: available equals capacity", () => {
    const total = find(buildMemberRows("e", { TMS: 80 }, {}, 160), "Total")!;
    expect(total).toMatchObject({ leaveHours: 0, availableCapacity: 160, pctProject: "50%" });
  });

  it("leave covers whole month: available 0, no divide-by-zero", () => {
    const rows = buildMemberRows("e", { TMS: 10, Leave: 200 }, {}, 160);
    expect(find(rows, "Total")).toMatchObject({ availableCapacity: 0, pctProject: "—" });
    expect(find(rows, "Over Capacity")?.hours).toBe(10);
    const none = buildMemberRows("e", { Leave: 160 }, {}, 160);
    expect(find(none, "Total")?.pctProject).toBe("0%");
    expect(find(none, "Unused Capacity")).toBeUndefined();
  });
});
