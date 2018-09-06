// Copyright (c) 2018-present, GM Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

import { expect } from "chai";
import { Time } from ".";

describe("Time", () => {
  const date = new Date(1511798097280);

  it("can be created from a date", () => {
    const time = Time.fromDate(date);
    expect(time.sec).to.equal(Math.floor(1511798097280 / 1000));
    expect(time.nsec).to.equal(280000000);
  });

  it("can convert to a date", () => {
    const time = new Time(1511798097, 280000000);
    expect(time.toDate()).to.eql(date);
  });

  it("can sort by compare", () => {
    const times = [new Time(1, 1), new Time(0, 0), new Time(1, 0), new Time(0, 1)];
    times.sort(Time.compare);
    expect(times).to.eql([{ sec: 0, nsec: 0 }, { sec: 0, nsec: 1 }, { sec: 1, nsec: 0 }, { sec: 1, nsec: 1 }]);
  });

  it("has lessThan functionality", () => {
    const min = new Time(0, 0);
    const oneNano = new Time(0, 1);
    const max = new Time(1, 1);
    expect(Time.isLessThan(min, min)).to.equal(false);
    expect(Time.isLessThan(max, min)).to.equal(false);
    expect(Time.isLessThan(oneNano, min)).to.equal(false);
    expect(Time.isLessThan(min, oneNano)).to.equal(true);
    expect(Time.isLessThan(min, max)).to.equal(true);
  });

  it("has greaterThan functionality", () => {
    const min = new Time(0, 0);
    const oneNano = new Time(0, 1);
    const max = new Time(1, 1);
    expect(Time.isGreaterThan(min, min)).to.equal(false);
    expect(Time.isGreaterThan(max, min)).to.equal(true);
    expect(Time.isGreaterThan(oneNano, min)).to.equal(true);
    expect(Time.isGreaterThan(min, oneNano)).to.equal(false);
    expect(Time.isGreaterThan(min, max)).to.equal(false);
  });

  it("tests for sameness", () => {
    const min = new Time(0, 0);
    const min2 = new Time(0, 0);
    const oneNano = new Time(0, 1);
    expect(min === min2).to.equal(false);
    expect(Time.areSame(min, min2)).to.equal(true);
    expect(Time.areSame(min, oneNano)).to.equal(false);
  });

  it("can add two times together", () => {
    expect(Time.add(new Time(0, 0), new Time(0, 0))).to.eql({ sec: 0, nsec: 0 });
    expect(Time.add(new Time(1, 100), new Time(2, 200))).to.eql({ sec: 3, nsec: 300 });
    expect(Time.add(new Time(0, 1e9 - 1), new Time(0, 1))).to.eql({ sec: 1, nsec: 0 });
    expect(Time.add(new Time(0, 1e9 - 1), new Time(0, 101))).to.eql({ sec: 1, nsec: 100 });
  });
});
