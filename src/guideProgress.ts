import type { GuideStep, Recipe } from './guideCatalog';

export function guideProgress(recipe: Recipe, index: number, done: (step: GuideStep) => boolean) {
  const completed = recipe.steps.filter(done).length;
  const positions = new Map(recipe.steps.map((step, i) => [step.id, i]));
  const memo = new Map<number, number>();
  const remaining = (at: number): number => {
    const step = recipe.steps[at]; if (!step) return 0;
    const cached = memo.get(at); if (cached !== undefined) return cached;
    const choices = step.choices?.filter(choice => choice.record !== false);
    const successors = choices ? choices.flatMap(choice => {
      const target = positions.get(choice.next);
      return target !== undefined && target > at ? [target] : [];
    }) : [at + 1];
    const count = (done(step) || choices?.length === 0 ? 0 : 1) + Math.max(0, ...successors.map(remaining));
    memo.set(at, count); return count;
  };
  // Back/retry branches do not create an unbounded or artificially larger task.
  const pending = remaining(index), current = recipe.steps[index];
  return { completed, total: Math.max(completed + pending, completed + (current && done(current) ? 0 : 1), 1) };
}
