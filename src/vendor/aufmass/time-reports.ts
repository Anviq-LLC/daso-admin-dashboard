// @ts-nocheck
// Synced copy, run "pnpm sync:aufmass" to refresh. Do not edit.
import {randomId} from './ids';
import type {Line,Project,Report,ReportKind,RoleRates,TimeEntry,TimeRates,TimeSheet,WorkerRole} from './types';
import {assignEmployeeCodes} from './employees';
import {reportCrews} from './report-crews';

export const reportKind=(report:Pick<Report,'kind'>):ReportKind=>report.kind||'measurement';
export const isTimeReport=(report:Pick<Report,'kind'>)=>reportKind(report)!=='measurement';
export const reportLabel=(report:Pick<Report,'kind'>)=>({measurement:'Aufmaß',extra:'Mehraufwand',timesheet:'Stundenzettel'})[reportKind(report)];
export const roleLabel=(role:WorkerRole)=>role==='foreman'?'Obermonteur':'Monteur';
export const allowanceLabel='Anfahrts-/Übernachtungspauschale';
export const allowanceCount=(entry:TimeEntry)=>entry.allowanceQuantity??entry.travelQuantity+entry.overnightQuantity;
export const defaultTimeRates=():TimeRates=>({fitter:{costHourly:null,billingHourly:null,allowanceCost:0,allowanceBilling:null,travelCost:0,travelBilling:null,overnightCost:0,overnightBilling:null},foreman:{costHourly:null,billingHourly:null,allowanceCost:0,allowanceBilling:null,travelCost:0,travelBilling:null,overnightCost:0,overnightBilling:null}});
function combinedRate(values:(number|null)[],ignoreZero=false){const known=[...new Set(values.filter(v=>v!==null&&(!ignoreZero||v!==0)))];return known.length===1?known[0]:known.length?null:ignoreZero?0:null;}
export function combinedRoleRates(rates:RoleRates):RoleRates{return{...rates,allowanceCost:rates.allowanceCost===undefined?combinedRate([rates.travelCost,rates.overnightCost],true):rates.allowanceCost,allowanceBilling:rates.allowanceBilling===undefined?combinedRate([rates.travelBilling,rates.overnightBilling]):rates.allowanceBilling};}
export const projectTimeRates=(project:Pick<Project,'timeRates'>):TimeRates=>{const rates=project.timeRates||defaultTimeRates();return{fitter:combinedRoleRates(rates.fitter),foreman:combinedRoleRates(rates.foreman)};};
export function validateTimeRates(input:unknown):TimeRates{
 if(input===undefined)return defaultTimeRates();
 if(!input||typeof input!=='object')throw Error('Bitte die Stundensätze und Pauschalen prüfen.');
 const result=defaultTimeRates();
 for(const role of ['fitter','foreman'] as const){const raw=(input as TimeRates)[role];if(!raw||typeof raw!=='object')throw Error('Sätze für Monteur und Obermonteur fehlen.');const value=combinedRoleRates(raw);
  for(const key of Object.keys(result[role]) as (keyof RoleRates)[]){if(key==='costHourly'){result[role].costHourly=null;continue;}if(key==='allowanceCost'){result[role].allowanceCost=0;continue;}const n=value[key];if(n===null&&['billingHourly','allowanceCost','allowanceBilling','travelBilling','overnightBilling'].includes(key)){Object.assign(result[role],{[key]:null});continue;}if(typeof n!=='number'||!Number.isSafeInteger(n)||n<0||n>1e8)throw Error('Sätze müssen gültige Eurobeträge mit höchstens zwei Nachkommastellen sein.');Object.assign(result[role],{[key]:n});}
 }
 return result;
}
export function calendarDate(value:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T12:00:00Z'))||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value)throw Error('Ungültiges Datum im Stundenbericht.');return value;}
export function offsetDate(value:string,days:number){const d=new Date(calendarDate(value)+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
export function timeDates(anchor:string,mode:'day'|'week'){if(mode==='day')return[calendarDate(anchor)];const d=new Date(calendarDate(anchor)+'T12:00:00Z');return Array.from({length:7},(_,i)=>offsetDate(anchor,i-(d.getUTCDay()||7)+1));}
export function timeReportBounds(sheet:Pick<TimeSheet,'anchorDate'|'mode'|'entries'>){const dates=[...new Set(sheet.entries.map(entry=>calendarDate(entry.date)))].sort();return{date:dates[0]||calendarDate(sheet.anchorDate),endDate:dates.at(-1)||calendarDate(sheet.anchorDate)};}
export const timeCostLabel=(_report:Pick<Report,'teamWork'>)=>'Nachunternehmerkosten';
export const weekdayShort=(date:string)=>new Date(date+'T12:00:00Z').toLocaleDateString('de-DE',{weekday:'short',timeZone:'UTC'}).replace(/\.$/,'');
export function workMinutes(entry:Pick<TimeEntry,'start'|'end'|'pauseMinutes'>):number|null{
 const clock=(s:string)=>/^([01]\d|2[0-3]):[0-5]\d$/.test(s)?Number(s.slice(0,2))*60+Number(s.slice(3)):null;
 const start=clock(entry.start),end=clock(entry.end);
 if(start===null||end===null||end<=start||!Number.isSafeInteger(entry.pauseMinutes)||entry.pauseMinutes<0||entry.pauseMinutes>=end-start)return null;
 return end-start-entry.pauseMinutes;
}
export type TimeWorker={id:string;name:string;code:string;trial:boolean;contractorRate:number|null|undefined};
export function timeWorkers(report:Report):TimeWorker[]{
 if(report.crews?.length)return reportCrews(report).flatMap(crew=>timeWorkers({...report,crews:undefined,team:crew.team,teamWork:crew.teamWork,employeeMembers:crew.employeeMembers}));
 if(report.teamWork){const codes=assignEmployeeCodes(report.teamWork.workers.map((worker,index)=>{const parts=worker.name.trim().split(/\s+/);return{id:`sub:${report.teamWork!.code}:${index}`,firstName:parts[0]||'Mitarbeiter',lastName:parts.slice(1).join(' ')||parts[0]||'Sub',code:''};}));return codes.map((worker,index)=>({id:worker.id,name:report.teamWork!.workers[index].name,code:worker.code,trial:false,contractorRate:report.teamWork!.hourlyRate}));}
 return (report.employeeMembers||[]).map(m=>({id:m.employeeId,name:m.name,code:m.code,trial:m.trial,contractorRate:undefined}));
}
export function entryRates(project:Project,worker:TimeWorker,role:WorkerRole):RoleRates{return{...projectTimeRates(project)[role],costHourly:worker.contractorRate??null,allowanceCost:0,...(worker.contractorRate===undefined?{allowanceCost:0,travelCost:0,overnightCost:0}:{})};}
// Only editable drafts follow project billing rates. Ready reports retain the
// recorded rates and amounts used for customer documents and weekly closures.
export function projectPricedReport(report:Report,project:Project):Report{
 if(!isTimeReport(report)||!report.timeSheet||report.state!=='draft')return report;
 const workers=timeWorkers(report),timeSheet={...report.timeSheet,entries:report.timeSheet.entries.map(entry=>{
  const worker=workers.find(w=>w.id===entry.workerId);if(!worker)return entry;
  const current=entryRates(project,worker,entry.role),{billingHourlyOverride,billingHourlyBase,allowanceBillingOverride,allowanceBillingBase,...rest}=entry;
  return{...rest,rates:{...entry.rates||current,costHourly:worker.contractorRate!==undefined?entry.rates?.costHourly??current.costHourly:null,billingHourly:current.billingHourly,...(entry.allowanceQuantity!==undefined?{allowanceBilling:current.allowanceBilling,allowanceCost:0}:{}),...(worker.contractorRate===undefined?{allowanceCost:0,travelCost:0,overnightCost:0}:{})}};
 })};const next={...report,timeSheet};return{...next,lines:timeLines(next)};
}
export function editTimeEntry(entry:TimeEntry,patch:Partial<TimeEntry>,project:Project,worker:TimeWorker):TimeEntry{
 const next={...entry,...patch},roleChanged=patch.role&&patch.role!==entry.role,current=entryRates(project,worker,next.role);
 next.rates={...(roleChanged?current:entry.rates||current),billingHourly:current.billingHourly,allowanceBilling:current.allowanceBilling,allowanceCost:0,...(worker.contractorRate===undefined?{costHourly:null,allowanceCost:0,travelCost:0,overnightCost:0}:{})};
 if(patch.allowanceQuantity!==undefined&&entry.allowanceQuantity===undefined)next.rates.allowanceCost=current.allowanceCost;
 delete next.billingHourlyOverride;delete next.billingHourlyBase;delete next.allowanceBillingOverride;delete next.allowanceBillingBase;
 return next;
}

export function copyTimeEntry(source:TimeEntry,target:TimeEntry,project:Project,worker:TimeWorker):TimeEntry{return editTimeEntry(target,{role:source.role,start:source.start,end:source.end,pauseMinutes:source.pauseMinutes,task:source.task,allowanceQuantity:allowanceCount(source),travelQuantity:0,overnightQuantity:0},project,worker);}
export function newTimeEntry(project:Project,report:Report,date:string,worker:TimeWorker):TimeEntry{return{id:randomId(),date,workerId:worker.id,name:worker.name,code:worker.code,role:'fitter',start:'',end:'',pauseMinutes:0,task:'',allowanceQuantity:report.parentReportId?0:1,travelQuantity:0,overnightQuantity:0,rates:entryRates(project,worker,'fitter')};}
export function timeReadiness(report:Report):string[]{
 const entries=report.timeSheet?.entries||[],issues:string[]=[];
 if(!entries.length)issues.push('Bitte mindestens einen Arbeitstag mit Mitarbeiter erfassen.');
 for(const e of entries){const who=`${weekdayShort(e.date)} ${e.code}`;if(workMinutes(e)===null)issues.push(`${who}: Anfang, Ende und Pause prüfen.`);if(!e.task.trim())issues.push(`${who}: ausgeführte Arbeiten fehlen.`);if(!report.parentReportId&&timeWorkers(report).find(w=>w.id===e.workerId)?.contractorRate!==undefined&&e.rates?.costHourly==null)issues.push(`${who}: Nachunternehmerkostensatz im Team fehlt.`);if(e.rates?.billingHourly==null)issues.push(`${who}: Projektstundenverrechnungssatz für ${roleLabel(e.role)} fehlt.`);if(e.allowanceQuantity!==undefined){if(e.allowanceQuantity>0&&e.rates?.allowanceBilling==null)issues.push(`${who}: ${allowanceLabel} für die Abrechnung im Projekt fehlt.`);}else{if(e.travelQuantity>0&&e.rates?.travelBilling==null||e.overnightQuantity>0&&e.rates?.overnightBilling==null)issues.push(`${who}: gespeicherter Pauschalensatz im Projekt fehlt.`);}}
 return [...new Set(issues)];
}
export function timePricingComplete(report:Report){return !isTimeReport(report)||!!report.timeSheet?.entries.length&&report.timeSheet.entries.every(e=>workMinutes(e)!==null&&e.rates?.billingHourly!=null&&(e.allowanceQuantity!==undefined?(!e.allowanceQuantity||e.rates?.allowanceBilling!=null):(!e.travelQuantity||e.rates?.travelBilling!=null)&&(!e.overnightQuantity||e.rates?.overnightBilling!=null)));}
export function timeRevenueAvailable(report:Report){return !isTimeReport(report)||!!report.timeSheet?.entries.some(entry=>workMinutes(entry)!==null&&entry.rates?.billingHourly!=null||(entry.allowanceQuantity!==undefined?entry.allowanceQuantity>0&&entry.rates?.allowanceBilling!=null:entry.travelQuantity>0&&entry.rates?.travelBilling!=null||entry.overnightQuantity>0&&entry.rates?.overnightBilling!=null));}
export function timeDayReport(report:Report,date:string){const day=reportDays(report).find(day=>day.date===date);if(!day)return null;return isTimeReport(day)&&day.timeSheet?{...day,date,endDate:date,timeSheet:{...day.timeSheet,mode:'day' as const,anchorDate:date}}:day;}
export function canonicalTimeSheet(project:Project,report:Report,old?:Report):TimeSheet{
 const input=report.timeSheet;if(!input||!['day','week'].includes(input.mode)||!Array.isArray(input.entries)||input.entries.length>140)throw Error('Bitte Tages- oder Wochenbericht mit höchstens 140 Einträgen wählen.');
 const anchorDate=calendarDate(input.anchorDate),allowed=new Set(timeDates(anchorDate,input.mode)),workers=timeWorkers(report),seen=new Set<string>(),ids=new Set<string>(),prior=old?.timeSheet;
 const entries=input.entries.map(e=>{const date=calendarDate(e.date);if(!allowed.has(date))throw Error('Arbeitstag gehört nicht zum gewählten Berichtszeitraum.');const worker=workers.find(w=>w.id===e.workerId);if(!worker)throw Error('Bitte die Besetzung für den Arbeitstag neu auswählen.');const identity=date+'|'+worker.id;if(seen.has(identity))throw Error('Ein Mitarbeiter darf pro Tag nur einmal eingetragen werden.');seen.add(identity);
  if(!['foreman','fitter'].includes(e.role))throw Error('Bitte Monteur oder Obermonteur auswählen.');
  for(const value of [e.pauseMinutes,...(e.allowanceQuantity!==undefined?[e.allowanceQuantity]:[e.travelQuantity,e.overnightQuantity])])if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>1440)throw Error('Pause und Pauschalenanzahl müssen gültige ganze Zahlen sein.');
  for(const value of [e.start,e.end])if(typeof value!=='string'||value&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))throw Error('Ungültige Uhrzeit.');
  const before=prior?.entries.find(p=>p.id===e.id&&p.workerId===worker.id),id=before?.id||randomId();if(ids.has(id))throw Error('Stundenzeile wurde doppelt eingetragen.');ids.add(id);
  const rates=before?.role===e.role&&before.rates?{...before.rates}:entryRates(project,worker,e.role);
  // Billing is authoritative at project level while a draft is edited. Ignore
  // legacy per-person overrides and any client-supplied rates or cost values.
  const current=entryRates(project,worker,e.role);if(e.allowanceQuantity!==undefined&&before&&before.allowanceQuantity===undefined){rates.allowanceCost=current.allowanceCost;rates.allowanceBilling=current.allowanceBilling;}
  for(const key of ['billingHourly','travelBilling','overnightBilling','allowanceCost','allowanceBilling'] as const)if(rates[key]==null)rates[key]=current[key]??null;
  rates.billingHourly=current.billingHourly;if(e.allowanceQuantity!==undefined){rates.allowanceBilling=current.allowanceBilling;rates.allowanceCost=0;}
  if(worker.contractorRate===undefined){rates.costHourly=null;rates.allowanceCost=0;rates.travelCost=0;rates.overnightCost=0;}
  if(before?.allowanceQuantity!==undefined&&e.allowanceQuantity===undefined)throw Error('Dieser Eintrag verwendet die gemeinsame Pauschale. Bitte das Formular neu laden.');
  return{id,date,workerId:worker.id,name:worker.name,code:worker.code,role:e.role,start:e.start,end:e.end,pauseMinutes:e.pauseMinutes,task:String(e.task||'').trim().slice(0,6000),...(e.allowanceQuantity!==undefined?{allowanceQuantity:e.allowanceQuantity,travelQuantity:0,overnightQuantity:0}:{travelQuantity:e.travelQuantity,overnightQuantity:e.overnightQuantity}),rates};
 }).sort((a,b)=>a.date.localeCompare(b.date)||a.code.localeCompare(b.code,'de'));
 return{mode:input.mode,anchorDate,factor:prior?.factor??project.factor,entries};
}
export function timeLines(report:Report):Line[]{
 if(!isTimeReport(report)||!report.timeSheet)return report.lines;
 const kind=reportKind(report),prefix=kind==='extra'?'MW':'SZ',factor=report.timeSheet.factor;
 return report.timeSheet.entries.flatMap(e=>{const role=e.role==='foreman'?'OM':'M',base={positionId:`service:${kind}:${e.role}`,description:`${reportLabel(report)} · ${roleLabel(e.role)}`,employeeFactor:factor,remark:`${e.code} · ${e.task}`,serviceDate:e.date,workerId:e.workerId},minutes=workMinutes(e),rows:Line[]=[];
  if(minutes!==null){const price=e.rates?.billingHourly??0;rows.push({...base,id:e.id+':h',number:prefix+'-'+role,unit:'Std',price,employeePrice:Math.round(price*factor),quantity:minutes/60,exactMinutes:minutes});}
  const fees=e.allowanceQuantity!==undefined?[['p',e.allowanceQuantity,e.rates?.allowanceBilling??0,allowanceLabel] as const]:[['a',e.travelQuantity,e.rates?.travelBilling??0,'Anfahrt'] as const,['u',e.overnightQuantity,e.rates?.overnightBilling??0,'Übernachtung'] as const];
  for(const [type,quantity,price,label] of fees)if(quantity)rows.push({...base,id:e.id+':'+type,positionId:base.positionId+':'+type,number:prefix+'-'+role+'-'+type.toUpperCase(),description:`${reportLabel(report)} · ${label} · ${roleLabel(e.role)}`,unit:'St',price,employeePrice:Math.round(price*factor),quantity});
  return rows;
 });
}
export const lineCustomerValue=(line:Line)=>line.exactMinutes===undefined?Math.round(line.quantity*line.price):Math.floor((line.exactMinutes*line.price+30)/60);
export function timeCost(report:Report):number|null{const subIds=new Set(timeWorkers(report).filter(w=>w.contractorRate!==undefined).map(w=>w.id));if(!subIds.size)return null;/* Linked extra hours are included in the manually entered parent costs. */if(report.parentReportId)return 0;const entries=(report.timeSheet?.entries||[]).filter(e=>report.teamWork&&!report.crews?.length||subIds.has(e.workerId));if(!entries.length)return null;let cost=0;for(const e of entries){const minutes=workMinutes(e);if(minutes===null||!e.rates||e.rates.costHourly==null)return null;cost+=Math.floor((minutes*e.rates.costHourly+30)/60)+(e.allowanceQuantity!==undefined?e.allowanceQuantity*(report.state==='ready'?e.rates.allowanceCost||0:0):e.travelQuantity*e.rates.travelCost+e.overnightQuantity*e.rates.overnightCost);}return cost;}
export function reportDays(report:Report):Report[]{if(!isTimeReport(report)||!report.timeSheet?.entries.length)return[report];return [...new Set(report.timeSheet.entries.map(e=>e.date))].sort().map(date=>{const entries=report.timeSheet!.entries.filter(e=>e.date===date),workerIds=new Set(entries.map(e=>e.workerId)),day={...report,date,endDate:date,timeSheet:{...report.timeSheet!,entries},employeeMembers:report.employeeMembers?.filter(m=>workerIds.has(m.employeeId))};return{...day,lines:timeLines(day)};});}
export function withTimeCrew(report:Report,project:Project,patch:Partial<Report>):Report{const next={...report,...patch};if(!isTimeReport(next)||!next.timeSheet)return next;const previousWorkers=new Set(timeWorkers(report).map(w=>w.id)),workers=timeWorkers(next),dates=next.timeSheet.entries.length?[...new Set(next.timeSheet.entries.map(e=>e.date))]:next.timeSheet.mode==='day'?[next.timeSheet.anchorDate]:[];next.timeSheet={...next.timeSheet,entries:dates.flatMap(date=>workers.filter(worker=>!next.parentReportId||!previousWorkers.has(worker.id)||next.timeSheet!.entries.some(e=>e.date===date&&e.workerId===worker.id)).map(worker=>next.timeSheet!.entries.find(e=>e.date===date&&e.workerId===worker.id)||newTimeEntry(project,next,date,worker)))};next.lines=timeLines(next);return next;}
