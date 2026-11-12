// @ts-nocheck
// Synced copy, run "pnpm sync:aufmass" to refresh. Do not edit.
import type {EmployeeMember,ProjectEmployee} from './types';

export function assignEmployeeCodes(employees:ProjectEmployee[],previous:ProjectEmployee[]=[]):ProjectEmployee[]{
 const letters=(name:string)=>Array.from(name.trim().normalize('NFD').replace(/\p{M}/gu,'').replace(/ß/g,'SS').toUpperCase().replace(/[^\p{L}]/gu,''));
 const baseCode=(employee:ProjectEmployee)=>(letters(employee.firstName)[0]||'')+(letters(employee.lastName)[0]||'');
 // Old two-letter codes with a number are regenerated when the roster is saved.
 // Already stored report snapshots keep their original codes.
 const unchanged=new Map<string,string>(),reserved=new Set<string>();
 for(const p of previous){if(p.code&&!reserved.has(p.code)&&!new RegExp('^'+baseCode(p)+'[0-9]+$','u').test(p.code)&&employees.some(e=>e.id===p.id&&e.firstName===p.firstName&&e.lastName===p.lastName)){unchanged.set(p.id,p.code);reserved.add(p.code);}}
 const used=new Set(unchanged.values());
 return employees.map(e=>{
  const existing=unchanged.get(e.id);if(existing)return{...e,code:existing};
  const first=letters(e.firstName),last=letters(e.lastName);if(!first.length||!last.length)return{...e,code:''};
  const base=first[0]+last[0];let code=base;
  for(const letter of [...first.slice(1),...last.slice(1)]){if(!used.has(code))break;code+=letter;}
  // Completely identical names can exhaust every name letter.
  if(used.has(code)){const full=code;let n=2;while(used.has(code))code=full+'-'+n++;}
  used.add(code);return{...e,code};
 });
}
export function employeeTeamCode(members:EmployeeMember[]):string{return [...members].sort((a,b)=>a.code.localeCompare(b.code,'de',{numeric:true})||a.employeeId.localeCompare(b.employeeId)).map(m=>m.code).join(' / ');}

export const TRIAL_EMPLOYEE_ID='__daso_trial__';
export function findEmployee(employees:ProjectEmployee[],id:string){return employees.find(e=>e.id===id||e.legacyIds?.includes(id));}
export function employeeChoices(employees:ProjectEmployee[],members:EmployeeMember[]):EmployeeMember[]{
 const choices=employees.filter(e=>!e.inactive||members.some(m=>m.employeeId===e.id||e.legacyIds?.includes(m.employeeId))).map(e=>{const stored=members.find(m=>m.employeeId===e.id||e.legacyIds?.includes(m.employeeId));return stored||{employeeId:e.id,name:e.firstName+' '+e.lastName,code:e.code,trial:false};});
 return [...choices,...members.filter(m=>m.employeeId!==TRIAL_EMPLOYEE_ID&&!findEmployee(employees,m.employeeId)),trialEmployee(members)];
}
export function trialEmployee(members:EmployeeMember[]=[]):EmployeeMember {
 const stored=members.find(m=>m.employeeId===TRIAL_EMPLOYEE_ID),used=new Set(members.filter(m=>m.employeeId!==TRIAL_EMPLOYEE_ID).map(m=>m.code));if(stored&&!used.has(stored.code))return {...stored,name:'Probearbeiter',trial:true};
 let code='PB';for(const letter of 'ROBEARBEITER'){if(!used.has(code))break;code+=letter;}let n=2;const base=code;while(used.has(code))code=base+n++;
 return {employeeId:TRIAL_EMPLOYEE_ID,name:'Probearbeiter',code,trial:true};
}
