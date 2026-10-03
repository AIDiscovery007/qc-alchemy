import test from 'node:test';
import assert from 'node:assert/strict';
import { galleryAnchor, galleryLayout } from '../lib/gallery-layout.ts';
const works = Array.from({length:1200},(_,index)=>({id:String(index),width: index%3===0?1600:1000,height:index%3===1?1400:1000}));
test('mixed original ratios produce non-overlapping shortest columns',()=>{
  const layout=galleryLayout(works,992,false);
  for(const rect of layout.rects) {
    assert.ok(rect.x>=0 && rect.x+rect.width<=993);
    assert.equal(rect.height-52,rect.width*rect.work.height/rect.work.width);
    const previous=layout.rects.filter(other=>other.x===rect.x&&other.y<rect.y).at(-1);
    if(previous)assert.ok(rect.y>=previous.y+previous.height+layout.gap-.01);
  }
  const mid=layout.height/2;
  assert.ok(layout.rects.filter(r=>r.y+r.height>mid-650&&r.y<mid+800+650).length<45);
});
test('single-column gap changes and prepended results preserve the visible work',()=>{
  const original=galleryLayout(works,308,false),top=original.rects[600].y;
  const dense=galleryLayout(works,308,true);
  assert.equal(galleryAnchor(original,dense,top),dense.rects[600].y);
  assert.equal(galleryAnchor(dense,original,dense.rects[600].y),top);
  const inserted=galleryLayout([{id:'new',width:1000,height:1000},...works],308,false);
  assert.equal(galleryAnchor(original,inserted,top),inserted.rects[601].y);
});
