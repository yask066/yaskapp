'use strict';
// Runs in the existing API image. Only read-only DB/S3 operations; stdout is a protected manifest.
const {createHash} = require('node:crypto');
const {Pool} = require('pg');
const {S3Client, ListObjectsV2Command, GetObjectCommand} = require('@aws-sdk/client-s3');
// A disconnected/killed Docker client must not leave a source inspector alive indefinitely.
const watchdog = setTimeout(() => process.exit(1), 240000);
watchdog.unref();

async function waitForMinio(endpoint) {
  const url = new URL('/minio/health/ready', endpoint);
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {signal: AbortSignal.timeout(3000)});
      if (response.ok) return;
    } catch (_) {
      // The isolated restored MinIO may still be starting.
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('MinIO did not become ready');
}

async function main() {
  const pool = new Pool({connectionString:process.env.DATABASE_URL, max:1, connectionTimeoutMillis:10000});
  const storage = new S3Client({endpoint:process.env.S3_ENDPOINT,region:process.env.S3_REGION,
    forcePathStyle:process.env.S3_FORCE_PATH_STYLE !== 'false',
    credentials:{accessKeyId:process.env.S3_ACCESS_KEY_ID,secretAccessKey:process.env.S3_SECRET_ACCESS_KEY},
    maxAttempts:3});
  try {
    await waitForMinio(process.env.S3_ENDPOINT);
    const client = await pool.connect();
    let tables;
    let sequences;
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query("SET LOCAL timezone TO 'UTC'");
      const names = (await client.query(`SELECT schemaname, tablename FROM pg_tables
        WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY schemaname, tablename`)).rows;
      tables = [];
      for (const {schemaname,tablename} of names) {
        const quote = value => '"' + value.replaceAll('"','""') + '"';
        const qualified = quote(schemaname) + '.' + quote(tablename);
        const result = await client.query(`SELECT count(*)::text AS rows,
          md5(COALESCE(string_agg(md5(row_to_json(t)::text), '' ORDER BY md5(row_to_json(t)::text)), '')) AS digest
          FROM ${qualified} t`);
        tables.push({schema:schemaname,table:tablename,...result.rows[0]});
      }
      sequences=[];
      for(const row of (await client.query(`SELECT schemaname,sequencename FROM pg_sequences
        WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY schemaname,sequencename`)).rows) {
        const quote = value => '"' + value.replaceAll('"','""') + '"';
        const value=(await client.query(`SELECT last_value::text, is_called FROM ${quote(row.schemaname)}.${quote(row.sequencename)}`)).rows[0];
        sequences.push({...row,...value});
      }
      await client.query('COMMIT');
    } finally {client.release();}
    const objects=[];
    let continuation;
    do {
      const page=await storage.send(new ListObjectsV2Command({Bucket:process.env.S3_BUCKET,ContinuationToken:continuation}));
      for(const item of page.Contents ?? []) {
        const object=await storage.send(new GetObjectCommand({Bucket:process.env.S3_BUCKET,Key:item.Key}));
        const hash=createHash('sha256');
        let bytes=0;
        for await(const chunk of object.Body){hash.update(chunk);bytes+=chunk.length;}
        if(bytes!==item.Size)throw new Error('Object size changed during inspection');
        objects.push({key:item.Key,bytes,sha256:hash.digest('hex')});
      }
      continuation=page.IsTruncated?page.NextContinuationToken:undefined;
      if(page.IsTruncated&&!continuation)throw new Error('Incomplete object listing');
    }while(continuation);
    objects.sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
    console.log(JSON.stringify({tables,sequences,objects}));
  } finally {storage.destroy();await pool.end();}
}
main().catch(()=>{console.error('Database/media inspection failed; details suppressed to protect credentials');process.exitCode=1;})
  .finally(()=>clearTimeout(watchdog));
