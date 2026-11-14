import { describe, expect, it } from 'vitest';
import { c, type Recipe, type GuideStep } from './guideCatalog';
import { guideProgress } from './guideProgress';
const make = (id: string, choices?: GuideStep['choices']): GuideStep => ({ id, title: c(id,id), action:c(id,id), expected:c(id,id), place:c(id,id), sources:['googleMfa'], ...(choices?{choices}:{}) });
const recipe:Recipe={id:'example',title:c('Example','例'),steps:[
  make('choose',[{label:c('Short','短い'),next:'short'},{label:c('Long','長い'),next:'long-1'}]),
  make('short',[{label:c('Finish','完了'),next:'finish'}]),make('long-1'),make('long-2'),make('finish'),
]};
describe('work progress across branches',()=>{
  it('estimates one remaining path, rather than adding mutually exclusive branches',()=>{expect(guideProgress(recipe,0,()=>false)).toEqual({completed:0,total:4});});
  it('updates after a shorter path is selected and does not count skipped operations as done',()=>{expect(guideProgress(recipe,1,s=>s.id==='choose')).toEqual({completed:1,total:3});expect(guideProgress(recipe,4,s=>['choose','short'].includes(s.id))).toEqual({completed:2,total:3});});
  it('does not grow or complete from retry, blocked or deferred branches',()=>{const r={...recipe,steps:[make('blocked',[{label:c('Retry','再試行'),next:'blocked',record:false}])]};expect(guideProgress(r,0,()=>false)).toEqual({completed:0,total:1});});
  it('keeps a final unconfirmed operation below full progress',()=>{expect(guideProgress(recipe,4,s=>s.id!=='finish')).toEqual({completed:4,total:5});});
  it('shows existing completion without forcing a new operation',()=>{expect(guideProgress(recipe,4,()=>true)).toEqual({completed:5,total:5});});
});
