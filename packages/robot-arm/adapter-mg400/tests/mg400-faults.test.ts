import { describe, expect, it } from '@rstest/core';
import { mg400Faults } from '../src/mg400-faults.js';

describe('MG400 fault text', () => {
  it('carries the controller catalog description for a known code', () => {
    const [fault] = mg400Faults([[85]]);
    expect(fault.code).toBe('85');
    // 85 is the emergency-stop alarm on the MG400 controller catalog.
    expect(fault.description?.zh).toContain('急停');
    expect(fault.description?.en).toMatch(/emergency stop/i);
    expect(fault.solution?.zh).toBeTruthy();
    // The controller's own level comes through verbatim.
    expect(fault.level).toBe(0);
    // The English catalog text stays the plain message for non-localized callers.
    expect(fault.message).toBe(fault.description?.en);
  });

  it('falls back to a generated message for a code outside the catalog', () => {
    const [fault] = mg400Faults([[65000]]);
    expect(fault.description).toBeUndefined();
    expect(fault.message).toBe('MG400 controller fault 65000');
  });

  it('reports one card when the controller repeats the same code', () => {
    // A flat reply can list the alarm twice; the operator must not see a
    // duplicate that reads like two independent faults.
    expect(mg400Faults([[85, 85]])).toHaveLength(1);
    expect(mg400Faults([[85, 85], [85]])).toHaveLength(2);
  });

  it('reports joint and linkage limits without assigning linkage faults to a fifth joint', () => {
    const [joint, linkage] = mg400Faults([[66, 73]]);
    expect(joint.affected).toEqual({ joint: 2 });
    expect(joint.limitDirection).toBe('positive');
    expect(linkage.affected).toEqual({ mechanism: 'parallelogram' });
    expect(linkage.description?.zh).toContain('负限位');
  });

  it('reads servo groups from the servo catalog, not the controller one', () => {
    const faults = mg400Faults([[], [1]]);
    expect(faults).toHaveLength(1);
    expect(faults[0].category).toBe('motion');
    expect(faults[0].message).toMatch(/J1 servo/);
  });
});
