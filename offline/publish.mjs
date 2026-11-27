import { readFile,writeFile } from "node:fs/promises";
import { randomBytes,createCipheriv } from "node:crypto";

const lines=(await readFile(".dev.vars.production","utf8")).trim().split(/\r?\n/);
const secrets=Object.fromEntries(lines.map(line=>{
  const split=line.indexOf("=");
  return [line.slice(0,split),JSON.parse(line.slice(split+1))];
}));
const profile=JSON.parse(secrets.ACCOUNTS)["artem-m"];
if (!profile) throw Error("Artem profile missing");
const diskPath="app:/kalendare-offline-shared.json";
async function disk(route,path,method="GET") {
  const url=new URL("https://cloud-api.yandex.net/v1/disk/resources"+route);
  url.searchParams.set("path",path);
  if (route==="/upload") url.searchParams.set("overwrite","true");
  const response=await fetch(url,{method,headers:{Authorization:"OAuth "+secrets.DISK_TOKEN},signal:AbortSignal.timeout(15000),redirect:"error"});
  if (response.status===404 && route==="/download") {
    const failure=await response.json();
    if (failure.error==="DiskNotFoundError") return null;
  }
  if (!response.ok) throw Error("Disk "+route+" HTTP "+response.status);
  return response.status===204 ? null : response.json();
}
const link=await disk("/download","app:/artem-m.json");
let data={};
if (link) {
  const response=await fetch(link.href,{signal:AbortSignal.timeout(15000)});
  if (!response.ok) throw Error("Profile download failed");
  data=(await response.json()).data ?? {};
}
const settings=JSON.parse(data["shift-calendar-v1"] ?? "{}");
const crews=JSON.parse(data["shift-calendar-crews-v1"] ?? '["Бригада 1","Бригада 2","Бригада 3"]');
if (profile.firstCrewName) crews[0]=profile.firstCrewName;
const snapshot={format:"kalendare-shared",version:1,exportedAt:new Date().toISOString(),
  settings:{base:"2026-10-21",overrides:settings.overrides ?? {}},crews,
  notes:JSON.parse(data["shift-calendar-notes-v1"] ?? "{}")};
const receipt=".dev.offline-invite.json";
let key;
try { key=Buffer.from(JSON.parse(await readFile(receipt,"utf8")).key,"base64"); }
catch (error) { if (error.code!=="ENOENT") throw error; key=randomBytes(32); }
if (key.length!==32) throw Error("Invalid stored encryption key");
const iv=randomBytes(12);
const cipher=createCipheriv("aes-256-gcm",key,iv);
const encrypted=Buffer.concat([cipher.update(JSON.stringify(snapshot),"utf8"),cipher.final(),cipher.getAuthTag()]);
const upload=await disk("/upload",diskPath);
const response=await fetch(upload.href,{method:"PUT",body:JSON.stringify({format:"kalendare-encrypted",version:1,iv:iv.toString("base64"),data:encrypted.toString("base64")}),signal:AbortSignal.timeout(15000)});
if (!response.ok) throw Error("Shared file upload HTTP "+response.status);
const metadata=await disk("",diskPath);
if (!metadata.public_url) await disk("/publish",diskPath,"PUT");
const {public_url:source}=await disk("",diskPath);
if (!source) throw Error("Shared file link missing");
const fragment=new URLSearchParams({source,key:key.toString("base64")});
const url="https://doppetrov-beep.github.io/Kalendare/offline/#"+fragment;
await writeFile(receipt,JSON.stringify({source,key:key.toString("base64"),url},null,2));
console.log("Encrypted reader snapshot published.");
