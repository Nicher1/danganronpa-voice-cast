const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../release-countdown.js');
const at=text=>Date.parse(text);

test('counts down to midnight on 14 January 2027 in Denmark',()=>{
  assert.equal(C.TARGET,at('2027-01-13T23:00:00Z'));
  assert.deepEqual(C.parts(at('2027-01-12T22:58:55Z')),{days:1,hours:0,minutes:1,seconds:5,total:86465});
  assert.deepEqual(C.parts(at('2027-01-14T05:00:00+01:00')),{days:0,hours:0,minutes:0,seconds:0,total:0},'never negative');
});

test('phases escalate, then the release day, then it disappears',()=>{
  const id=text=>C.phase(at(text)).id;
  assert.equal(id('2026-11-23T12:00:00+01:00'),'far');
  assert.equal(id('2026-12-20T12:00:00+01:00'),'month');
  assert.equal(id('2027-01-10T12:00:00+01:00'),'week');
  assert.equal(id('2027-01-13T12:00:00+01:00'),'day');
  assert.equal(id('2027-01-13T23:30:00+01:00'),'hour');
  assert.equal(id('2027-01-14T00:00:00+01:00'),'released');
  assert.equal(id('2027-01-14T23:59:59+01:00'),'released');
  assert.equal(id('2027-01-15T00:00:00+01:00'),'gone');
});

test('the spoken summary uses singular and plural words',()=>{
  assert.equal(C.spoken({days:1,hours:2,minutes:1}),'1 day, 2 hours and 1 minute until Danganronpa 2×2 is released.');
});
