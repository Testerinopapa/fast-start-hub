import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

async function setup() {
  const db=new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon,authenticated,service_role;');
  await db.exec(await readFile(new URL('../drizzle/migrations/0000_openoutfind_ai_safeguards.sql',import.meta.url),'utf8'));
  await db.exec('set role service_role');
  return db;
}
const reserve=async(db,run,n)=>(await db.query('select public.openoutfind_ai_reserve($1,$2) as result',[`github-${run}-1`,n.toString(16).padStart(64,'0')])).rows[0].result;
test('only server functions can admit requests or access the AI ledger',async()=>{
  const db=await setup(); try {
    for(const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(reserve(db,1,1),/permission denied/);
      for(const table of ['openoutfind_ai_budget','openoutfind_ai_requests']) await assert.rejects(db.query(`select * from public.${table}`),/permission denied/);
    }
  }finally{await db.close();}
});
test('40 requests per run and duplicate admission consumes no additional budget',async()=>{
  const db=await setup();try{
    assert.equal(await reserve(db,1,1),'admitted');assert.equal(await reserve(db,1,1),'duplicate');
    for(let n=2;n<=40;n++) assert.equal(await reserve(db,1,n),'admitted');
    assert.equal(await reserve(db,1,41),'limit');
    assert.equal((await db.query('select requests from public.openoutfind_ai_budget')).rows[0].requests,40);
  }finally{await db.close();}
});
test('100 requests per UTC day across all runs',async()=>{
  const db=await setup();try{
    for(let n=1;n<=100;n++) assert.equal(await reserve(db,n,n),'admitted');
    assert.equal(await reserve(db,101,101),'limit');
    await db.exec("update public.openoutfind_ai_budget set budget_day=budget_day-1");
    assert.equal(await reserve(db,101,101),'admitted');
    assert.equal((await db.query('select requests from public.openoutfind_ai_budget')).rows[0].requests,1);
  }finally{await db.close();}
});
test('failed runs and permanent pauses block new entry points including next day',async()=>{
  const db=await setup();try{
    await reserve(db,1,1);await db.query('select public.openoutfind_ai_stop($1,false)',['github-1-1']);
    assert.equal(await reserve(db,1,2),'stopped');assert.equal(await reserve(db,2,2),'admitted');
    await db.query('select public.openoutfind_ai_stop($1,true)',['github-2-1']);
    await db.exec("update public.openoutfind_ai_budget set budget_day=budget_day-1");
    assert.equal(await reserve(db,3,3),'paused');
  }finally{await db.close();}
});