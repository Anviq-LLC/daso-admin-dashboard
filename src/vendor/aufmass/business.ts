// @ts-nocheck
// Synced copy, run "pnpm sync:aufmass" to refresh. Do not edit.
import type { Aggregate, Data, Line, Project, Report, ReportKind, EmployeeMember } from './types';
import {employeeTeamCode} from './employees';
import {reportCrews,crewWorkers,measurementHoursIssues} from './report-crews';
import {isTimeReport,lineCustomerValue,reportDays,reportKind,timeCost,timePricingComplete,timeReportBounds,timeRevenueAvailable} from './time-reports';
export const money = (cents: number) => new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(cents/100);
export const qty2 = (value:number)=>new Intl.NumberFormat('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2}).format(value);
export const qty = (value: number) => new Intl.NumberFormat('de-DE',{maximumFractionDigits:4}).format(value);
export const today = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin'}).format(new Date());
export const dateLabel = (value: string) => value ? new Date(value.slice(0,10)+'T12:00:00Z').toLocaleDateString('de-DE',{timeZone:'UTC'}) : '—';
export function weekOf(date: string) { const d=new Date(date+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()+4-(d.getUTCDay()||7)); const year=d.getUTCFullYear(); const first=new Date(Date.UTC(year,0,1)); return `${year}-W${String(Math.ceil((((+d-+first)/86400000)+1)/7)).padStart(2,'0')}`; }
export function weekLabel(week: string) {const [y,w]=week.split('-W'); return `KW ${w}/${y?.slice(2)}`;}
export function weekStart(week: string) { const [y,w]=week.split('-W').map(Number); const d=new Date(Date.UTC(y,0,4,12)); d.setUTCDate(d.getUTCDate()-(d.getUTCDay()||7)+1+(w-1)*7); return d.toISOString().slice(0,10); }
export function shiftWeek(week:string,amount:number){const d=new Date(weekStart(week)+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+amount*7);return weekOf(d.toISOString().slice(0,10));}
export function parseDecimal(value:unknown):number {if(typeof value==='number')return value;let s=String(value??'').trim().replace(/\s|€|EUR/gi,'');if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');return Number(s);}
// Money stays in customer cents. Apply the recorded decimal factor before the
// single final rounding, using integers to avoid binary floating-point half-cents.
function decimalValue(parts:{customer:number;factor:number}[]):number {
 if(!parts.length)return 0;
 const values=parts.map(({customer,factor})=>{if(!Number.isSafeInteger(customer)||!Number.isFinite(factor)||factor<0)throw Error('Ungültiger Betrag oder Multiplikator.');const [coefficient,exponent='0']=String(factor).split('e'),decimals=coefficient.split('.')[1]?.length||0,shift=Number(exponent)-decimals;return{customer:BigInt(customer),numerator:BigInt(coefficient.replace('.',''))*BigInt(10)**BigInt(Math.max(0,shift)),scale:Math.max(0,-shift)};});
 const scale=values.reduce((max,v)=>Math.max(max,v.scale),0),denominator=BigInt(10)**BigInt(scale),numerator=values.reduce((sum,v)=>sum+v.customer*v.numerator*BigInt(10)**BigInt(scale-v.scale),BigInt(0));
 return Number(numerator<BigInt(0)?-((-numerator+denominator/BigInt(2))/denominator):(numerator+denominator/BigInt(2))/denominator);
}
export function employeeValue(parts:{customer:number;factor:number}[]):number{if(parts.some(p=>p.factor>1))throw Error('Ungültiger Mitarbeiterfaktor.');return decimalValue(parts);}
export function totals(lines:Line[],fallbackFactor=.9){const parts=lines.map(l=>({customer:lineCustomerValue(l),factor:l.employeeFactor??fallbackFactor}));return{customer:parts.reduce((sum,p)=>sum+p.customer,0),employee:employeeValue(parts)};}
export function reportTotals(reports:Report[],fallbackFactor=.9){const plain=reports.filter(r=>!r.revenueAllocation),base=totals(plain.flatMap(r=>r.lines),fallbackFactor);return reports.filter(r=>r.revenueAllocation).reduce((s,r)=>({customer:s.customer+r.revenueAllocation!.customer,employee:s.employee+r.revenueAllocation!.employee}),base);}
function allocate(amount:number,weights:number[]){const sum=weights.reduce((s,v)=>s+v,0);if(!sum)return weights.map(()=>0);const sign=amount<0?-1:1,parts=weights.map((w,i)=>{const n=BigInt(Math.abs(amount))*BigInt(w);return{i,value:Number(n/BigInt(sum)),rest:n%BigInt(sum)};});let left=Math.abs(amount)-parts.reduce((s,p)=>s+p.value,0);for(const p of [...parts].sort((a,b)=>a.rest===b.rest?a.i-b.i:a.rest>b.rest?-1:1)){if(left--<=0)break;p.value++;}return parts.map(p=>p.value*sign);}
// Virtual crew slices are for internal day/team accounting only. The stored
// report and customer quantities remain a single, undivided measurement.
export function crewReports(report:Report,fallbackFactor=.9):Report[]{
 if(!report.crews?.length)return[report];const crews=reportCrews(report),total=reportTotals([report],fallbackFactor),weights=isTimeReport(report)?crews.map(c=>{const ids=new Set(crewWorkers(c).map(w=>w.id));return report.lines.filter(l=>ids.has(l.workerId||'')).reduce((s,l)=>s+lineCustomerValue(l),0);}):crews.map(c=>c.share),customers=allocate(total.customer,weights),employees=allocate(total.employee,weights);
 return crews.flatMap((crew,i)=>{const ids=new Set(crewWorkers(crew).map(w=>w.id)),entries=report.timeSheet?.entries.filter(e=>ids.has(e.workerId)),lines=isTimeReport(report)?report.lines.filter(l=>ids.has(l.workerId||'')):report.lines.map(l=>({...l,quantity:l.quantity*crew.share/10000}));if(isTimeReport(report)&&!entries?.length)return[];return[{...report,crews:undefined,team:crew.team,teamWork:crew.teamWork,employeeMembers:isTimeReport(report)?crew.employeeMembers.filter(m=>entries?.some(e=>e.workerId===m.employeeId)):crew.employeeMembers,...(report.timeSheet?{timeSheet:{...report.timeSheet,entries:entries||[]}}:{}),lines,revenueAllocation:{customer:customers[i],employee:employees[i]}}];});
}
// Start with equal shares. Half of each trial worker's share goes to the
// regular employees. Allocate remaining cents by largest remainder.
export function employeeShares(report:Report,fallbackFactor=.9,includeIncomplete=false):(EmployeeMember&{employee:number;share:number})[]{
 if(report.crews?.length)return crewReports(report,fallbackFactor).flatMap(r=>employeeShares(r,fallbackFactor,includeIncomplete));
 const members=report.employeeMembers||[],normal=members.filter(m=>!m.trial).length,trial=members.length-normal;
 if(!members.length||!normal||!includeIncomplete&&!timePricingComplete(report))return [];
 const amount=reportTotals([report],fallbackFactor).employee,sign=amount<0?-1:1;
 const personal=members.map(m=>report.lines.filter(l=>l.workerId===m.employeeId).reduce((sum,l)=>sum+lineCustomerValue(l),0)),personalTotal=personal.reduce((a,b)=>a+b,0);
 const transferred=personal.reduce((sum,value,i)=>sum+(members[i].trial?value:0),0);
 const weights=isTimeReport(report)&&personalTotal>0?members.map((m,i)=>m.trial?personal[i]*normal:personal[i]*normal*2+transferred):members.map(m=>trial?(m.trial?normal:2*normal+trial):1),denominator=BigInt(weights.reduce((a,b)=>a+b,0));
 const shares=members.map((member,i)=>{const numerator=BigInt(Math.abs(amount))*BigInt(weights[i]);return{...member,employee:Number(numerator/denominator),share:weights[i]/Number(denominator),remainder:numerator%denominator};});
 let rest=Math.abs(amount)-shares.reduce((s,m)=>s+m.employee,0);for(const row of [...shares].sort((a,b)=>a.remainder===b.remainder?b.share-a.share||a.employeeId.localeCompare(b.employeeId):a.remainder>b.remainder?-1:1)){if(rest--<=0)break;row.employee++;}
 return shares.map(({remainder,...member})=>({...member,employee:member.employee*sign}));
}
export function employeeTurnover(reports:Report[],fallbackFactor=.9,includeIncomplete=false){
 const assigned=reports.flatMap(r=>crewReports(r,fallbackFactor)).filter(r=>r.employeeMembers?.length&&r.employeeMembers.some(m=>!m.trial)&&(includeIncomplete||timePricingComplete(r))),map=new Map<string,{employeeId:string;name:string;code:string;employee:number;trialReports:number;reports:number}>();
 for(const report of assigned)for(const member of employeeShares(report,fallbackFactor,includeIncomplete)){const old=map.get(member.employeeId)||{employeeId:member.employeeId,name:member.name,code:member.code,employee:0,trialReports:0,reports:0};old.employee+=member.employee;old.trialReports+=member.trial?1:0;old.reports++;map.set(member.employeeId,old);}
 const values=[...map.values()],correction=reportTotals(assigned,fallbackFactor).employee-values.reduce((s,m)=>s+m.employee,0);
 const ranked=[...values].sort((a,b)=>b.employee-a.employee||a.employeeId.localeCompare(b.employeeId));let remaining=Math.abs(correction);while(remaining>0&&ranked.length){let changed=false;for(const member of ranked){if(correction<0&&member.employee<=0)continue;member.employee+=correction<0?-1:1;changed=true;if(--remaining===0)break;}if(!changed)break;}
 return values.sort((a,b)=>a.name.localeCompare(b.name,'de'));
}
export function reportCost(report:Report):number|null{if(report.crews?.length){const costs=crewReports(report).filter(r=>r.teamWork).map(reportCost);return !costs.length||costs.some(c=>c===null)?null:costs.reduce<number>((s,c)=>s+c!,0);}if(isTimeReport(report))return timeCost(report);if(measurementHoursIssues(report).length)return null;const work=report.teamWork;if(!work||typeof work.hourlyRate!=='number'||!Number.isSafeInteger(work.hourlyRate)||work.hourlyRate<0||!work.workers.length||work.workers.some(w=>typeof w.hours!=='number'||!Number.isFinite(w.hours)||w.hours<0))return null;return decimalValue(work.workers.map(w=>({customer:work.hourlyRate!,factor:w.hours!})));}
export function teamResult(reports:Report[],fallbackFactor=.9){
 const value=reportTotals(reports,fallbackFactor);
 // Own employees have no internal cost rate. They must not hide the costs
 // of other crews, while an incomplete subcontractor must never count as 0.
 const contractors=reports.flatMap(r=>crewReports(r,fallbackFactor)).filter(r=>r.teamWork),costs=contractors.map(reportCost),missingHours=costs.filter(c=>c===null).length;
 const cost=!costs.length||missingHours?null:costs.reduce<number>((sum,c)=>sum+c!,0);
 return{...value,cost,profit:cost===null||!reports.every(timePricingComplete)?null:value.employee-cost,missingHours};
}
export function dailyTeams(reports:Report[],fallbackFactor=.9){const days=new Map<string,{date:string;endDate:string;teams:Map<string,{team:string;reports:Report[]}>}>();for(const report of reports.flatMap(reportDays).flatMap(r=>crewReports(r,fallbackFactor))){const endDate=report.endDate||report.date,key=report.date+'|'+endDate,day=days.get(key)||{date:report.date,endDate,teams:new Map()},item=day.teams.get(report.team)||{team:report.team,reports:[]};item.reports.push(report);day.teams.set(report.team,item);days.set(key,day);}return [...days.values()].sort((a,b)=>b.date.localeCompare(a.date)||b.endDate.localeCompare(a.endDate)).map(day=>({...day,teams:[...day.teams.values()].map(t=>({...t,...teamResult(t.reports,fallbackFactor)})).sort((a,b)=>a.team.localeCompare(b.team,'de',{numeric:true}))}));}
export type RevenueCell={amount:number|null;complete:boolean;count:number};
export type CostSummary={cost:number|null;profit:number|null;missingHours:number};
export type DailyRevenueRow={id:string;label:string;detail:string;values:Record<ReportKind,RevenueCell>;total:RevenueCell;accounting?:CostSummary;changedRevenue?:Partial<Record<ReportKind|'total',boolean>>};
const revenueKinds:ReportKind[]=['measurement','extra','timesheet'];
const emptyRevenue=():Record<ReportKind,RevenueCell>=>({measurement:{amount:0,complete:true,count:0},extra:{amount:0,complete:true,count:0},timesheet:{amount:0,complete:true,count:0}});
function addRevenue(a:RevenueCell,b:RevenueCell):RevenueCell{const known=a.count>0&&a.amount!==null||b.count>0&&b.amount!==null;return{amount:known?(a.amount||0)+(b.amount||0):null,complete:a.complete&&b.complete,count:a.count+b.count};}
function revenueTotal(values:Record<ReportKind,RevenueCell>):RevenueCell{const cells=revenueKinds.map(kind=>values[kind]).filter(c=>c.count);return{amount:cells.some(c=>c.amount!==null)?cells.reduce((sum,c)=>sum+(c.amount||0),0):null,complete:cells.every(c=>c.complete),count:cells.reduce((sum,c)=>sum+c.count,0)};}
// Split weekly hours into actual service days before grouping. Own crews use
// stable employee identities, so a changed initials order does not split them.
// Multi-day measurement quantities have no daily allocation; keep their range
// visible instead of inventing or repeating a daily amount.
export function dailyRevenue(reports:Report[],fallbackFactor=.9){
 const days=new Map<string,{date:string;endDate:string;reports:Report[]}>();
 for(const report of reports.flatMap(reportDays).flatMap(r=>crewReports(r,fallbackFactor))){const endDate=report.endDate||report.date,key=report.date+'|'+endDate,day=days.get(key)||{date:report.date,endDate,reports:[]};day.reports.push(report);days.set(key,day);}
 return [...days.values()].sort((a,b)=>b.date.localeCompare(a.date)||b.endDate.localeCompare(a.endDate)).map(day=>{
  const crews=new Map<string,Report[]>(),employees=new Map<string,DailyRevenueRow>();
  for(const report of day.reports){const key=report.teamWork?'sub:'+report.teamWork.code:report.employeeMembers?.length?'own:'+report.employeeMembers.map(m=>m.employeeId).sort().join('|'):'legacy:'+report.team;const crew=crews.get(key)||[];crew.push(report);crews.set(key,crew);}
  const teams:DailyRevenueRow[]=[...crews].map(([id,crew])=>{
   const first=crew[0],values=emptyRevenue();
   // The combined total adds the displayed, rounded report-type amounts.
   for(const kind of revenueKinds){const selected=crew.filter(r=>reportKind(r)===kind);if(!selected.length)continue;const complete=selected.every(timePricingComplete),available=selected.some(timeRevenueAvailable);values[kind]={amount:available?reportTotals(selected,fallbackFactor).employee:null,complete,count:selected.length};
    for(const member of employeeTurnover(selected,fallbackFactor,true)){const row=employees.get(member.employeeId)||{id:member.employeeId,label:member.code+' · '+member.name,detail:'',values:emptyRevenue(),total:{amount:0,complete:true,count:0}};row.values[kind]=addRevenue(row.values[kind],{amount:available?member.employee:null,complete,count:member.reports});employees.set(member.employeeId,row);}
   }
   const total=revenueTotal(values),result=teamResult(crew,fallbackFactor),accounting=crew.some(r=>r.teamWork)?{cost:result.cost,profit:result.cost===null||!total.complete||total.amount===null?null:total.amount-result.cost,missingHours:result.missingHours}:undefined;
   return{id,label:first.employeeMembers?.length?employeeTeamCode(first.employeeMembers):first.team,detail:first.teamWork?[first.teamWork.company,...first.teamWork.workers.map(w=>w.name)].filter(Boolean).join(' · '):(first.employeeMembers||[]).map(m=>m.name).join(' · '),values,total,accounting};
  }).sort((a,b)=>a.label.localeCompare(b.label,'de',{numeric:true}));
  const values=emptyRevenue();for(const team of teams)for(const kind of revenueKinds)values[kind]=addRevenue(values[kind],team.values[kind]);
  const total=revenueTotal(values),costRows=teams.flatMap(t=>t.accounting?[t.accounting]:[]),cost=costRows.length&&costRows.every(c=>c.cost!==null)?costRows.reduce((s,c)=>s+c.cost!,0):null;
  const accounting=costRows.length?{cost,profit:cost===null||!total.complete||total.amount===null?null:total.amount-cost,missingHours:costRows.reduce((s,c)=>s+c.missingHours,0)}:undefined;
  return{date:day.date,endDate:day.endDate,drafts:day.reports.some(r=>r.state==='draft'),summary:{values,total,accounting},teams,employees:[...employees.values()].map(row=>({...row,total:revenueTotal(row.values)})).sort((a,b)=>a.label.localeCompare(b.label,'de',{numeric:true}))};
 });
}
export function reportDateRange(report:Pick<Report,'date'|'endDate'>&Partial<Pick<Report,'kind'|'timeSheet'>>){const bounds=isTimeReport(report)&&report.timeSheet?timeReportBounds(report.timeSheet):report;return dateLabel(bounds.date)+(bounds.endDate&&bounds.endDate!==bounds.date?' – '+dateLabel(bounds.endDate):'');}
export function aggregateKey(row:Pick<Aggregate,'number'|'unit'|'price'|'employeeFactor'>){return[row.number,row.unit,row.price,row.employeeFactor].join('|');}
export function aggregate(reports:Report[],fallbackFactor=.9):Aggregate[]{const map=new Map<string,Aggregate>();for(const r of reports)for(const l of r.lines){const employeeFactor=l.employeeFactor??fallbackFactor,key=aggregateKey({...l,employeeFactor});const row=map.get(key)||{key,number:l.number,description:l.description,unit:l.unit,price:l.price,employeePrice:l.employeePrice,employeeFactor,quantity:0,customerValue:0,employeeValue:0};row.quantity+=l.quantity;row.customerValue+=lineCustomerValue(l);map.set(key,row);}return [...map.values()].map(row=>({...row,employeeValue:employeeValue([{customer:row.customerValue,factor:row.employeeFactor!}])})).sort((a,b)=>a.number.localeCompare(b.number,'de',{numeric:true}));}
export function aggregateTotals(rows:Aggregate[],fallbackFactor=.9){return{customer:rows.reduce((s,r)=>s+r.customerValue,0),employee:employeeValue(rows.map(r=>({customer:r.customerValue,factor:r.employeeFactor??fallbackFactor})))};}
export function normalizeFinancialData(data:Data):Data{
 const factors=new Map(data.projects.map(p=>[p.id,p.factor]));
 const reports=data.reports.map(r=>({...r,lines:r.lines.map(l=>({...l,employeeFactor:l.employeeFactor??factors.get(r.projectId)??.9}))}));
 return{...data,reports};
}
export function deadlineFrom(date:string,days:number,working:boolean){const d=new Date(date.slice(0,10)+'T12:00:00Z');for(let n=0;n<days;){d.setUTCDate(d.getUTCDate()+1);if(!working||d.getUTCDay()!==0)n++;}return d.toISOString().slice(0,10);}
export const defaultTemplate = `Sehr geehrte Damen und Herren,\n\nanbei senden wir Ihnen die aktuellen Aufmaße aus {{kw}} zu.\n\nSollten Sie Fragen haben oder Anpassungen bzw. Kürzungen vornehmen, wenden Sie sich bitte vorab an unseren Kollegen {{kontakt}}.\n\nGenerelle Empfehlung von uns nach VOB/B § 2 Abs. 2 ist das Aufmaß Basis der Vergütung und soll nach § 14 Nr. 2 VOB/B möglichst gemeinsam vom Auftragnehmer und Auftraggeber vorgenommen werden.\n\nKürzungen ohne Angabe von Gründen bzw. Freigabe von unserem Obermonteur sind nicht zulässig. Klare Rechenfehler sind hiervon ausgenommen.\n\nBitte senden Sie uns das Aufmaß innerhalb der vertraglichen Frist per E-Mail zurück.\n\nNach Ablauf der vertraglich vereinbarten Prüffrist werden wir die erfassten Leistungen auf Grundlage der vertraglichen Vereinbarungen abrechnen. Bitte teilen Sie uns Einwendungen innerhalb dieser Frist schriftlich und positionsbezogen mit.`;
export const hourlyNote='Hinweis für Stundenlohnzettel: Sofern § 15 Abs. 3 VOB/B vertraglich anwendbar ist, sind Stundenlohnzettel spätestens binnen sechs Werktagen zurückzugeben. Die dort geregelte Anerkennung betrifft Stundenlohnzettel; sie gilt nicht automatisch für dieses Mengenaufmaß.';
export function mailBody(project:Project,week:string){return project.template.replaceAll('{{kw}}',weekLabel(week)).replaceAll('{{kontakt}}',project.contact||'unseren Ansprechpartner').replaceAll('{{projekt}}',project.name)+(project.hourlyNote?'\n\n'+hourlyNote:'');}
export const reviewText='Bitte prüfen Sie das Aufmaß innerhalb der vertraglich vereinbarten Prüffrist und teilen Sie uns Einwendungen schriftlich und positionsbezogen mit. Nach Ablauf dieser Frist werden wir die Leistungen auf Grundlage der vertraglichen Vereinbarungen abrechnen.';
export function normalize(s:string){return s.toLowerCase().replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/ß/g,'ss').replace(/quadratmeter|quadrat meter/g,'qm').replace(/kubikmeter/g,'m3').replace(/stück|stueck/g,'st').replace(/[^a-z0-9.,]+/g,' ').trim();}
function distance(a:string,b:string){let prev=Array.from({length:b.length+1},(_,i)=>i);for(let i=0;i<a.length;i++){const next=[i+1];for(let j=0;j<b.length;j++)next.push(Math.min(next[j]+1,prev[j+1]+1,prev[j]+(a[i]===b[j]?0:1)));prev=next;}return prev[b.length];}
export function matchPositions<T extends {number:string;description:string}>(positions:T[],query:string):T[]{
 const q=normalize(query.replace(/\.{2,}|…/g,' '));if(!q)return positions.slice(0,40);
 const tokens=q.split(' ').filter(x=>x.length>1&&!['meter','st','qm','verbaut','montiert','und'].includes(x));
 return positions.map(p=>{
  const original=normalize(p.number+' '+p.description);
  // Keep the LV wording searchable while also matching both existing aliases.
  // Replacing it outright hid prefixes such as "wicke" and fragments like "falz".
  const variants=[...new Set([original,original.replace(/wickelfalz/g,'spiral'),original.replace(/spiral/g,'wickelfalz')])];
  const score=Math.max(...variants.map(s=>{
   const words=s.split(' ');let value=0;
   for(const t of tokens){if(s.includes(t)){value+=/\d/.test(t)?8:5;continue;}if(t.length>=4&&!/\d/.test(t)){const limit=t.length>=8?2:1;if(words.some(w=>distance(t,w)<=limit||(w.length>t.length&&distance(t,w.slice(0,t.length))<=limit)))value+=3;}}
   if(s.includes(q))value+=30;return value;
  }))+(original.includes(q)?2:0);
  return{p,score};
 }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,40).map(x=>x.p);
}
export function speechQuantity(text:string){const m=text.match(/(\d+(?:[,.]\d+)?)\s*(?:stück|stueck|meter|m²|quadratmeter|qm|lfm|m\b)/i);return m?parseDecimal(m[1]):null;}
