const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const dir=path.join(root,'supabase/functions/discord-voting');
const handler=fs.readFileSync(path.join(dir,'handler.mjs'),'utf8');
const entry=fs.readFileSync(path.join(dir,'index.ts'),'utf8').replace('import { createHandler } from "./handler.mjs";','');
const destination=path.resolve(process.argv[2]||path.join(root,'../output/discord-voting-index.ts'));
fs.mkdirSync(path.dirname(destination),{recursive:true});
fs.writeFileSync(destination,'// @ts-nocheck\n// Generated from the tested discord-voting sources. No credentials are embedded.\n'+handler+'\n'+entry);
console.log(destination);
