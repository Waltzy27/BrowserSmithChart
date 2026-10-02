import { describe, it, expect } from 'vitest';
import { moveItem } from '../src/ui/schematic';
describe('schematic reorder', () => {
  it('moves items like a drag-and-drop list', () => {
    expect(moveItem([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4]);
    expect(moveItem([1, 2, 3, 4], 3, 0)).toEqual([4, 1, 2, 3]);
    expect(moveItem([1, 2, 3, 4], 1, 1)).toEqual([1, 2, 3, 4]);
    expect(moveItem([1, 2, 3], 2, 9)).toEqual([1, 2, 3]);
  });
});
