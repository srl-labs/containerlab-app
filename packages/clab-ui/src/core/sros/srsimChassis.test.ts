import assert from "node:assert/strict";
import test from "node:test";

import type { SrosComponent } from "../types/editors";

import {
  cardSlotChoices,
  checkHardware,
  copyCard,
  describeChassis,
  findSrsimChassis,
  freeCardSlots,
  hardwareEnvKeys,
  fitToChassis,
  hardwareTargetKey,
  imageTag,
  installSlot,
  issueSlotId,
  layoutChassis,
  moveCard,
  nextMdaSlot,
  removeSlot,
  starterHardware,
  type SrsimChassis
} from "./srsimChassis";
import { SRSIM_CHASSIS_INFO } from "./srsimChassisInfo";

function chassis(type: string): SrsimChassis {
  const found = findSrsimChassis(type);
  assert.ok(found, `${type} is in the catalog`);
  return found;
}

function messages(found: SrsimChassis | undefined, sfm: string, components: SrosComponent[]): string[] {
  return checkHardware(found, sfm, components).map((issue) => issue.message);
}

test("finds a chassis whatever its case, and follows aliases", () => {
  assert.equal(chassis("sr-7s").name, "SR-7s");
  assert.equal(chassis(" SAR-MX ").name, "SAR-Mx");
  assert.equal(findSrsimChassis("not-a-chassis"), undefined);
  assert.equal(findSrsimChassis(undefined), undefined);
  assert.equal(findSrsimChassis("constructor"), undefined);

  const ess7 = chassis("ess-7");
  assert.equal(ess7.name, "ESS-7");
  assert.deepEqual(ess7.card, chassis("sr-7").card);
  assert.equal(ess7.cardSlots, 5);
});

test("reads what each chassis takes from the catalog", () => {
  const sr7s = chassis("sr-7s");
  assert.equal(sr7s.cardSlots, 6);
  assert.equal(sr7s.redundant, true);
  assert.equal(sr7s.integrated, false);
  assert.ok(sr7s.xiom.includes("iom-s-1.5t"));
  assert.equal(describeChassis(sr7s), "6 card slots · redundant CPMs · XIOMs");

  assert.equal(chassis("ixr-e2").fixedHardware, "cpm-ixr-e2");
  assert.equal(describeChassis(chassis("ixr-e2")), "Fixed hardware");
  assert.deepEqual(chassis("sar-hx").fixedMdas[3], "isa-ms-v");
  assert.equal(chassis("ixr-x").noSeparateMda, true);
  assert.deepEqual(chassis("ixr-x").mda, []);
  assert.equal(describeChassis(chassis("sr-1")), "Integrated");
  assert.equal(describeChassis(chassis("ixr-x")), "1 card slot");
});

test("accepts a configuration the chassis supports", () => {
  assert.deepEqual(
    messages(chassis("sr-7s"), "sfm-s", [
      { slot: "A", type: "cpm2-s" },
      { slot: "B", type: "cpm2-s" },
      {
        slot: 1,
        type: "xcm-7s",
        xiom: [{ slot: 1, type: "iom-s-1.5t", mda: [{ slot: 1, type: "not-checked-under-a-xiom" }] }]
      },
      { slot: 2, type: "xcm2-7s", mda: [{ slot: 1, type: "x2-s36-800g-qsfpdd-18.0t" }] }
    ]),
    []
  );
});

test("flags the same mismatches containerlab warns about", () => {
  const found = messages(chassis("sr-7"), "sfm-wrong", [
    { slot: "A", type: "cpm-wrong" },
    { slot: 6, type: "card-wrong", mda: [{ slot: 1, type: "mda-wrong" }] }
  ]);
  assert.deepEqual(found, [
    "sfm-wrong is not listed for SR-7",
    "cpm-wrong is not listed for SR-7",
    "SR-7 has only 5 card slots",
    "card-wrong is not listed for SR-7",
    "mda-wrong is not listed for SR-7"
  ]);

  assert.deepEqual(messages(chassis("ixr-x"), "", [{ slot: "B" }]), ["IXR-x has no second CPM"]);
  assert.deepEqual(messages(chassis("sr-1"), "", [{ slot: 1 }]), ["SR-1 takes no line cards"]);
  assert.deepEqual(messages(chassis("ixr-e2"), "", [{ slot: "A", type: "cpm-wrong" }]), [
    "IXR-e2 has fixed hardware: cpm-ixr-e2"
  ]);
  assert.deepEqual(messages(chassis("sar-hx"), "", [{ mda: [{ slot: 3, type: "wrong" }] }]), [
    "MDA slot 3 always holds isa-ms-v on SAR-Hx"
  ]);
  assert.deepEqual(messages(chassis("ixr-x"), "", [{ slot: 1, mda: [{ slot: 1, type: "any" }] }]), [
    "IXR-x takes no separate MDA"
  ]);
  assert.deepEqual(messages(chassis("sr-7"), "", [{ slot: 1, xiom: [{ slot: 1, type: "x" }] }]), [
    "SR-7 takes no XIOMs"
  ]);
});

test("flags what containerlab refuses to read, which stops a deploy", () => {
  const issues = messages(undefined, "", [
    {
      slot: 1,
      mda: [{ slot: 1, type: "a" }, { slot: 1, type: "a" }, { type: "a" }],
      xiom: [
        { slot: 1, type: "x", mda: [{ slot: 2, type: "m" }, { slot: 2, type: "m" }] },
        { slot: 1, type: "x" },
        { type: "x" }
      ]
    }
  ]);
  assert.deepEqual(issues, [
    "MDA slot 1 is used twice, which containerlab refuses to deploy",
    "MDA needs a slot number",
    "MDA under x1: slot 2 is used twice, which containerlab refuses to deploy",
    "XIOM slot 1 is used twice, which containerlab refuses to deploy",
    "XIOM needs a slot number"
  ]);
});

test("does not judge values set through variables, which containerlab expands first", () => {
  const variable = `\${ANY:=value}`;
  const components: SrosComponent[] = [
    { slot: "A", type: variable },
    { slot: 1, type: variable, mda: [{ slot: 1, type: variable }] },
    { slot: variable, type: "iom5-e" }
  ];
  assert.deepEqual(messages(chassis("sr-7"), variable, components), []);
  assert.equal(layoutChassis(chassis("sr-7"), components).cards.at(-1)?.label, variable);
  assert.deepEqual(messages(chassis("sar-hx"), "", [{ mda: [{ slot: 3, type: variable }] }]), []);
  assert.deepEqual(messages(chassis("ixr-e2"), "", [{ slot: "A", type: variable }]), []);
  assert.deepEqual(fitToChassis(chassis("sr-7"), variable, components), {
    components,
    sfm: variable
  });
});

test("finds env keys that override the hardware, on the node and on its components", () => {
  assert.deepEqual(
    hardwareEnvKeys(
      { NOKIA_SROS_CHASSIS: "sr-7", NOKIA_SROS_MDA_1: "x", NOKIA_SROS_SLOT: "A", OTHER: "1" },
      [{ slot: 1, extra: { env: { NOKIA_SROS_CARD: "c", NOKIA_SROS_XIOM_X1: "x", NOKIA_SROS_MDA_X1_1: "m" } } }, { slot: 2 }]
    ),
    ["NOKIA_SROS_CARD", "NOKIA_SROS_CHASSIS", "NOKIA_SROS_MDA_1", "NOKIA_SROS_MDA_X1_1", "NOKIA_SROS_XIOM_X1"]
  );
  assert.deepEqual(hardwareEnvKeys(undefined, []), []);
});

test("leaves out what containerlab does not check", () => {
  // Direct MDAs on a distributed CPM are not validated
  assert.deepEqual(
    messages(chassis("ixr-x"), "", [{ slot: "A", mda: [{ slot: 1, type: "not-a-cpm-mda" }] }]),
    []
  );
  // A card without a type runs with the slot's default
  assert.deepEqual(messages(chassis("sr-7"), "", [{ slot: 1 }]), []);
});

test("asks for missing types and refuses a repeated slot, with or without a catalog entry", () => {
  const components: SrosComponent[] = [
    { slot: 1, mda: [{ slot: 1 }], xiom: [{ slot: 1, mda: [{ slot: 1 }] }] },
    { slot: "1" }
  ];
  const issues = checkHardware(undefined, "", components);
  assert.deepEqual(
    issues.map((issue) => hardwareTargetKey(issue.target)),
    ["0.x.m0", "0.x0", "0.x0.m0", "1.slot", "cpm"]
  );
  assert.deepEqual(
    issues.map((issue) => issue.message),
    [
      "MDA 1 needs a type",
      "XIOM x1 needs a type",
      "MDA x1/1 needs a type",
      "Defined twice, which containerlab refuses to deploy",
      "A chassis with cards needs a CPM to deploy"
    ]
  );
});

test("wants a CPM on a distributed node, the one thing that stops a deploy", () => {
  const cards: SrosComponent[] = [{ slot: 1 }, { slot: 2 }];
  assert.deepEqual(messages(chassis("sr-7"), "", cards), ["A chassis with cards needs a CPM to deploy"]);
  assert.deepEqual(messages(chassis("sr-7"), "", [...cards, { slot: "B" }]), []);
  assert.deepEqual(messages(chassis("sr-7"), "", [{ slot: 1 }]), []);

  const fitted = fitToChassis(chassis("sr-7"), "", cards);
  assert.deepEqual(fitted.components, [{ slot: "A", type: "cpm5" }, ...cards]);
});

test("lays out a distributed chassis with its empty slots", () => {
  const layout = layoutChassis(chassis("sr-7s"), [{ slot: "A", type: "cpm2-s" }, { slot: 3 }]);
  assert.deepEqual(
    layout.control.map((slot) => [slot.id, slot.componentIndex]),
    [
      ["A", 0],
      ["B", undefined]
    ]
  );
  assert.deepEqual(
    layout.cards.map((slot) => [slot.id, slot.componentIndex]),
    [
      ["1", undefined],
      ["2", undefined],
      ["3", 1],
      ["4", undefined],
      ["5", undefined],
      ["6", undefined]
    ]
  );
});

test("keeps entries the chassis has no slot for, so they can be seen and removed", () => {
  const components: SrosComponent[] = [{ slot: "B" }, { slot: 9 }, { slot: 1 }, { slot: "1" }, { slot: "C" }];
  const layout = layoutChassis(chassis("ixr-x"), components);
  assert.deepEqual(
    layout.control.map((slot) => slot.id),
    ["A", "B"]
  );
  assert.deepEqual(
    layout.cards.map((slot) => [slot.id, slot.label]),
    [
      ["1", "1"],
      ["9", "9"],
      ["C", "C"],
      ["#3", "1"]
    ]
  );
});

test("lays out integrated, fixed and unknown chassis", () => {
  const sr1 = layoutChassis(chassis("sr-1"), []);
  assert.deepEqual(sr1.cards, []);
  assert.deepEqual(
    sr1.control.map((slot) => [slot.id, slot.builtIn]),
    [["A", true]]
  );

  const r6 = layoutChassis(chassis("ixr-r6"), []);
  assert.deepEqual(
    r6.control.map((slot) => [slot.id, slot.builtIn]),
    [
      ["A", true],
      ["B", false]
    ]
  );

  assert.deepEqual(layoutChassis(chassis("sr-1-24d"), []), { control: [], cards: [] });

  const unknown = layoutChassis(undefined, [{ slot: 2 }]);
  assert.deepEqual(
    unknown.cards.map((slot) => [slot.id, slot.componentIndex]),
    [
      ["2", 0],
      ["3", undefined]
    ]
  );
});

test("offers the open slots to move a card to", () => {
  const found = chassis("sr-7");
  assert.deepEqual(freeCardSlots(found, layoutChassis(found, [{ slot: 2 }, { slot: 3 }])), ["1", "4", "5"]);

  const open = freeCardSlots(undefined, layoutChassis(undefined, [{ slot: 2 }, { slot: 14 }]));
  assert.equal(open[0], "1");
  assert.ok(!open.includes("2"));
  assert.equal(open.at(-1), "15");
});

test("marks the tile of each issue", () => {
  const components: SrosComponent[] = [{ slot: "A", type: "wrong" }, { slot: 1, mda: [{ slot: 1 }] }];
  const found = chassis("sr-7");
  const layout = layoutChassis(found, components);
  const ids = checkHardware(found, "wrong", components).map(({ target }) => issueSlotId(target, layout));
  assert.deepEqual(ids, ["sfm", "A", "1"]);
});

test("installs hardware in the right place with a working type", () => {
  const sr7 = chassis("sr-7");
  const withCard = installSlot(sr7, [{ slot: "A", type: "cpm5" }, { slot: 3, type: "iom5-e" }], "2");
  assert.deepEqual(withCard, [
    { slot: "A", type: "cpm5" },
    { slot: 2, type: "iom5-e" },
    { slot: 3, type: "iom5-e" }
  ]);
  assert.deepEqual(installSlot(sr7, [], "1"), [{ slot: 1, type: "iom5-e" }]);
  assert.deepEqual(installSlot(sr7, [{ slot: 1 }], "A"), [{ slot: "A", type: "cpm5" }, { slot: 1 }]);
  assert.deepEqual(installSlot(undefined, [], "1"), [{ slot: 1 }]);
});

test("a second CPM on an integrated chassis names both slots and leaves their types alone", () => {
  const r6 = chassis("ixr-r6");
  assert.deepEqual(installSlot(r6, [], "B"), [{ slot: "A" }, { slot: "B" }]);
  assert.deepEqual(installSlot(r6, [{ mda: [{ slot: 1, type: "x" }] }], "B"), [
    { slot: "A", mda: [{ slot: 1, type: "x" }] },
    { slot: "B" }
  ]);
});

test("removes a slot's entry, keeping slot A named beside slot B", () => {
  const r6 = chassis("ixr-r6");
  const both: SrosComponent[] = [{ slot: "A", mda: [{ slot: 1, type: "x" }] }, { slot: "B" }];
  const layout = layoutChassis(r6, both);
  assert.deepEqual(removeSlot(r6, both, layout.control[0]), [{ slot: "A" }, { slot: "B" }]);
  assert.deepEqual(removeSlot(r6, both, layout.control[1]), [both[0]]);
  assert.deepEqual(removeSlot(r6, [{ mda: [] }], layoutChassis(r6, [{ mda: [] }]).control[0]), []);

  const sr7 = chassis("sr-7");
  const cards: SrosComponent[] = [{ slot: "A" }, { slot: 1 }];
  assert.deepEqual(removeSlot(sr7, cards, layoutChassis(sr7, cards).cards[0]), [{ slot: "A" }]);
  assert.deepEqual(removeSlot(sr7, cards, layoutChassis(sr7, cards).cards[1]), cards);
});

test("every starter build is one its chassis accepts", () => {
  for (const name of Object.keys(SRSIM_CHASSIS_INFO)) {
    const found = chassis(name);
    const { components, sfm } = starterHardware(found);
    if (found.fixedHardware === undefined && !found.integrated && found.cardSlots > 0) {
      assert.deepEqual(messages(found, sfm, components), [], name);
    }
  }
  assert.deepEqual(starterHardware(chassis("sr-7")), {
    components: [
      { slot: "A", type: "cpm5" },
      { slot: 1, type: "iom5-e", mda: [{ slot: 1, type: "me6-100gb-qsfp28" }] }
    ],
    sfm: "m-sfm6-7/12"
  });
});

test("fitting leaves nothing to flag on any chassis", () => {
  const anything: SrosComponent[] = [
    { slot: "A", type: "wrong" },
    { slot: "B", type: "wrong" },
    {
      slot: 1,
      type: "wrong",
      mda: [{ slot: 1, type: "wrong" }, { slot: 1, type: "wrong" }, { slot: 2, type: "wrong" }, { slot: 3 }, { type: "wrong" }]
    },
    { slot: 1 },
    { slot: 99, type: "wrong" },
    {
      slot: 2,
      type: "wrong",
      xiom: [
        { slot: 1, type: "wrong", mda: [{ slot: 1, type: "kept" }, { slot: 1, type: "kept" }, { slot: 2 }] },
        { slot: 2 },
        { slot: 2, type: "wrong" },
        { type: "wrong" }
      ]
    }
  ];
  for (const name of Object.keys(SRSIM_CHASSIS_INFO)) {
    const found = chassis(name);
    const fitted = fitToChassis(found, "wrong", anything);
    assert.deepEqual(messages(found, fitted.sfm, fitted.components), [], name);
  }
});

test("fitting moves a build between chassis and leaves what already fits alone", () => {
  const fitted = fitToChassis(chassis("sr-14s"), "sfm-s", [
    { slot: "A", type: "cpm2-s", extra: { env: { A: "1" } } },
    {
      slot: 1,
      type: "xcm-7s",
      xiom: [{ slot: 1, type: "iom-s-1.5t", mda: [{ slot: 1, type: "ms2-400gb-qsfpdd+2-100gb-qsfp28" }] }]
    }
  ]);
  assert.deepEqual(fitted, {
    sfm: "sfm-s",
    components: [
      { slot: "A", type: "cpm2-s", extra: { env: { A: "1" } } },
      {
        slot: 1,
        type: "xcm2-14s",
        xiom: [{ slot: 1, type: "iom-s-1.5t", mda: [{ slot: 1, type: "ms2-400gb-qsfpdd+2-100gb-qsfp28" }] }]
      }
    ]
  });
});

test("fitting an integrated chassis clears a wrong type instead of setting one", () => {
  const fitted = fitToChassis(chassis("sr-1"), "", [{ type: "wrong" }]);
  assert.equal(fitted.components[0].type, undefined);
});

test("copies and moves cards with everything on them", () => {
  const cards: SrosComponent[] = [
    { slot: "A" },
    { slot: 1, type: "t", mda: [{ slot: 1, type: "m" }], extra: { env: { X: "1" } } }
  ];
  assert.deepEqual(copyCard(cards, 1, "3")[2], { ...cards[1], slot: 3 });
  assert.deepEqual(moveCard(cards, 1, "4")[1], { ...cards[1], slot: 4 });
});

test("a moved card lands where the chassis has it, swapping with a card already there", () => {
  const cards: SrosComponent[] = [
    { slot: "A" },
    { slot: 1, type: "first", mda: [{ slot: 1, type: "m" }] },
    { slot: 2, type: "second" },
    { slot: 3, type: "third" }
  ];
  const slotsAndTypes = (list: SrosComponent[]) => list.map(({ slot, type }) => [slot, type]);

  assert.deepEqual(slotsAndTypes(moveCard(cards, 1, "5")), [
    ["A", undefined],
    [2, "second"],
    [3, "third"],
    [5, "first"]
  ]);
  const swapped = moveCard(cards, 1, "3");
  assert.deepEqual(slotsAndTypes(swapped), [
    ["A", undefined],
    [1, "third"],
    [2, "second"],
    [3, "first"]
  ]);
  assert.deepEqual(swapped[3].mda, cards[1].mda);
});

test("offers every card slot in chassis order, its own and taken ones included", () => {
  const found = chassis("sr-7");
  assert.deepEqual(cardSlotChoices(found, layoutChassis(found, [{ slot: 4 }, { slot: 1 }])), [
    "1",
    "2",
    "3",
    "4",
    "5"
  ]);
  // A card in a slot the chassis lacks can still stay there, and sorts by number
  const beyond = cardSlotChoices(found, layoutChassis(found, [{ slot: 12 }]));
  assert.deepEqual(beyond, ["1", "2", "3", "4", "5", "12"]);
  // Without a catalog entry the open range is offered around the card
  const open = cardSlotChoices(undefined, layoutChassis(undefined, [{ slot: 14 }]));
  assert.equal(open[0], "1");
  assert.equal(open.at(-1), "15");
});

test("picks the next free MDA slot around fixed ones", () => {
  assert.equal(nextMdaSlot([]), 1);
  assert.equal(nextMdaSlot([{ slot: 1 }, { slot: 3 }]), 2);
  assert.equal(nextMdaSlot([{ slot: 1 }], { 2: "fixed", 3: "fixed" }), 4);
});

test("reads the release from an image reference", () => {
  assert.equal(imageTag("registry.srlinux.dev/pub/nokia_srsim:26.3.R1"), "26.3.R1");
  assert.equal(imageTag("localhost:5000/nokia_srsim"), undefined);
  assert.equal(imageTag("localhost:5000/nokia_srsim:25.10"), "25.10");
  assert.equal(imageTag("nokia_srsim:"), undefined);
  assert.equal(imageTag(undefined), undefined);
});
