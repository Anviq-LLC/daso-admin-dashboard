// @ts-nocheck
// Synced copy, run "pnpm sync:aufmass" to refresh. Do not edit.
import type {EmployeeMember,Project,Report,ReportCrew,TeamWork} from './types';
import {employeeTeamCode,findEmployee,TRIAL_EMPLOYEE_ID,trialEmployee} from './employees';

export function reportCrews(report:Report):ReportCrew[]{return report.crews?.length?report.crews:[{id:'primary',team:report.team,employeeMembers:report.employeeMembers||[],teamWork:report.teamWork||null,share:10000}];}
export const hasContractors=(report:Report)=>reportCrews(report).some(c=>!!c.teamWork);
export function crewPatch(crews:ReportCrew[]):Partial<Report>{return{crews,team:crews.map(c=>c.team).filter(Boolean).join(' + '),teamWork:null,employeeMembers:[]};}
export function equalCrewShares(crews:ReportCrew[]):ReportCrew[]{return crews.map((crew,i)=>({...crew,share:Math.floor(10000/crews.length)+(i<10000%crews.length?1:0)}));}
export function crewWorkers(crew:ReportCrew){return crew.teamWork?crew.teamWork.workers.map((w,i)=>({id:`sub:${crew.teamWork!.code}:${i}`,name:w.name})):crew.employeeMembers.map(m=>({id:m.employeeId,name:m.name}));}
function need(ok:unknown,message:string):asserts ok{if(!ok)throw Error(message);}
const text=(v:unknown,max=200)=>String(v??'').trim().slice(0,max);
// Resolve names, codes and subcontractor rates on the server, never from inputs.
export function canonicalCrews(input:Report,project:Project,old:Report|undefined,maxHours:number,hourly:boolean):Partial<Report>{
 const multi=input.crews!==undefined;if(multi)need(Array.isArray(input.crews)&&input.crews.length>0&&input.crews.length<=20,'Bitte 1–20 Besetzungen auswählen.');
 const incoming=multi?input.crews!:reportCrews({...input,crews:undefined}),previous=old?reportCrews(old):[],ids=new Set<string>(),people=new Set<string>(),teams=new Set<string>();
 const crews=incoming.map(raw=>{const id=text(raw.id,100);need(id&&!ids.has(id),'Besetzung ist doppelt oder ungültig.');ids.add(id);const prior=previous.find(c=>c.id===id||!multi&&c.team===text(raw.team,300));let members:EmployeeMember[]=[],work:TeamWork|null=null,team=text(raw.team,300);
  need(!raw.employeeMembers?.length||!raw.teamWork,'Bitte je Besetzung Mitarbeiter oder ein Nachunternehmer-Team auswählen.');
  if(raw.employeeMembers?.length){need(Array.isArray(raw.employeeMembers)&&raw.employeeMembers.length<=20,'Bitte höchstens 20 Mitarbeiter je Besetzung auswählen.');members=raw.employeeMembers.map(m=>{const employeeId=text(m.employeeId,100),before=prior?.employeeMembers.find(p=>p.employeeId===employeeId),employee=findEmployee(project.employees||[],employeeId),identity=employee?.id||employeeId;need(identity&&!people.has(identity),'Ein Mitarbeiter kann im selben Bericht nur einer Besetzung zugeordnet werden.');people.add(identity);if(employeeId===TRIAL_EMPLOYEE_ID)return trialEmployee(prior?.employeeMembers||[]);need(before||employee,'Bitte den Mitarbeiter zuerst in der DaSo-Liste hinterlegen.');return{employeeId:before?.employeeId||employee!.id,name:before?.name??`${employee!.firstName} ${employee!.lastName}`,code:before?.code??employee!.code,trial:before?.trial===true};});members=members.map(m=>m.employeeId===TRIAL_EMPLOYEE_ID?trialEmployee(members):m);need(members.some(m=>!m.trial),'Bei Probearbeit muss ein regulärer Mitarbeiter dabei sein.');members.sort((a,b)=>a.code.localeCompare(b.code,'de',{numeric:true}));team=employeeTeamCode(members);}
  if(raw.teamWork){const code=text(raw.teamWork.code,80),before=previous.find(c=>c.teamWork?.code===code)?.teamWork,configured=project.teams?.find(t=>t.code===code);need(code===team&&!teams.has(code),'Nachunternehmer-Team ist doppelt oder stimmt nicht mit der Auswahl überein.');teams.add(code);need(before||configured,'Bitte das Team zuerst im Projekt hinterlegen.');const hourlyRate=before?before.hourlyRate:configured!.hourlyRate;need(typeof hourlyRate==='number'&&Number.isSafeInteger(hourlyRate)&&hourlyRate>=0,'Bitte den Kostensatz für das Nachunternehmer-Team im Projekt hinterlegen.');const names=before?before.workers.map(w=>w.name):configured!.employees.filter(Boolean);need(names.length&&Array.isArray(raw.teamWork.workers)&&raw.teamWork.workers.length===names.length,'Bitte die Mitarbeiter des Teams im Projekt prüfen.');work={code,company:before?.company??configured!.company,hourlyRate,workers:names.map((name,i)=>{const hours=raw.teamWork!.workers[i].hours;need(hourly||typeof hours==='number'&&Number.isFinite(hours)&&hours>=0&&hours<=maxHours,`Bitte gültige Stunden für ${name} eintragen.`);const dailyHours=hourly?undefined:canonicalDailyHours(raw.teamWork!.workers[i].dailyHours,input,hours,name);return{name,hours:hourly?null:hours,...(dailyHours?{dailyHours}:{})};})};}
  need(team&&(members.length||work||!multi&&prior&&!prior.teamWork&&!prior.employeeMembers.length&&team===prior.team),'Bitte jede Besetzung vollständig auswählen.');const share=multi?raw.share:10000;need(Number.isSafeInteger(share)&&share>=0&&share<=10000,'Umsatzanteile müssen zwischen 0 und 100 % liegen.');return{id,team,employeeMembers:members,teamWork:work,share};
 });
 need(hourly||crews.reduce((s,c)=>s+c.share,0)===10000,'Die Umsatzanteile aller Besetzungen müssen zusammen 100 % ergeben.');
 return multi?crewPatch(crews):{team:crews[0].team,teamWork:crews[0].teamWork,employeeMembers:crews[0].employeeMembers};
}

// A zero is an explicit non-working day. Missing days must never imply zero.
export function measurementDates(report:Pick<Report,'date'|'endDate'>):string[]{
 const start=Date.parse(report.date+'T12:00:00Z'),end=Date.parse((report.endDate||report.date)+'T12:00:00Z'),count=1+Math.round((end-start)/86400000);
 return !Number.isFinite(start)||!Number.isFinite(end)||count<1||count>7?[]:Array.from({length:count},(_,i)=>new Date(start+i*86400000).toISOString().slice(0,10));
}
export function dailyHoursTotal(worker:TeamWork['workers'][number],report:Pick<Report,'date'|'endDate'>):number|null{
 const dates=measurementDates(report),map=worker.dailyHours;if(!dates.length)return null;
 if(dates.length===1)return typeof worker.hours==='number'&&Number.isFinite(worker.hours)&&worker.hours>=0&&worker.hours<=24?worker.hours:null;
 if(!map||Object.keys(map).length!==dates.length||!dates.every(d=>Object.hasOwn(map,d)&&typeof map[d]==='number'&&Number.isFinite(map[d])&&map[d]>=0&&map[d]<=24))return null;
 return dates.reduce((s,d)=>s+map[d],0);
}
export function measurementHoursIssues(report:Report):string[]{
 if(report.kind&&report.kind!=='measurement')return[];
 return reportCrews(report).flatMap(c=>c.teamWork?c.teamWork.workers.flatMap(w=>{const total=dailyHoursTotal(w,report);return total===null||typeof w.hours!=='number'||Math.abs(total-w.hours)>.000001?[`${c.team}: Stunden für ${w.name} jedem einzelnen Aufmaßtag zuordnen (0 für arbeitsfreie Tage).`]:[];}):[]);
}
export function canonicalDailyHours(value:unknown,report:Pick<Report,'date'|'endDate'>,hours:number|null,name:string):Record<string,number>{
 const dates=measurementDates(report);need(dates.length,'Bitte den Aufmaßzeitraum prüfen.');
 if(dates.length===1){need(typeof hours==='number'&&Number.isFinite(hours)&&hours>=0&&hours<=24,`Bitte gültige Stunden für ${name} eintragen.`);return{[dates[0]]:hours};}
 need(value&&typeof value==='object'&&!Array.isArray(value),`Bitte die Stunden für ${name} jedem einzelnen Aufmaßtag zuordnen.`);
 const entries=Object.entries(value);need(entries.length===dates.length&&dates.every(d=>Object.hasOwn(value,d)),`Bitte die Stunden für ${name} an jedem Aufmaßtag angeben (0 für arbeitsfreie Tage).`);
 let total=0;const result:Record<string,number>={};
 for(const [date,amount]of entries){need(dates.includes(date),'Tagesstunden müssen innerhalb des Aufmaßzeitraums liegen.');need(typeof amount==='number'&&Number.isFinite(amount)&&amount>=0&&amount<=24,'Tagesstunden müssen zwischen 0 und 24 liegen.');total+=amount;result[date]=amount;}
 need(typeof hours==='number'&&Math.abs(total-hours)<.000001,`Die Tagesstunden für ${name} müssen den Gesamtstunden entsprechen.`);return result;
}
