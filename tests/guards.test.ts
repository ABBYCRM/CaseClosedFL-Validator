import {describe,it,expect} from "vitest";
import {actionFingerprint,mayExecute,observeProgress} from "../src/agent/guards.js";
import {initialState} from "../src/agent/state.js";
describe("anti-loop",()=>{it("fingerprints identical actions deterministically",()=>expect(actionFingerprint("a","b",{x:1})).toBe(actionFingerprint("a","b",{x:1})));it("blocks after configured identical failures",()=>{const s=initialState(),f="x";s.failedActions=[f,f];expect(mayExecute(s,f)).toBe(false);});it("detects repeated no-progress cycles",()=>{const s=initialState();observeProgress(s,1,1);observeProgress(s,1,1);expect(s.health).toBe("LOOP_DETECTED");});});
