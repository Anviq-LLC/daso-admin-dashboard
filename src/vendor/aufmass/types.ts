// @ts-nocheck
// Synced copy, run "pnpm sync:aufmass" to refresh. Do not edit.
export type ProjectTeam = {planId?:string;code:string;company:string;employees:[string,string];hourlyRate?:number|null};
export type ProjectEmployee = {planId?:string;inactive?:boolean;id:string;firstName:string;lastName:string;code:string;legacyIds?:string[]};
export type ProjectContact = {id:string;name:string;role:string;phone:string;email:string;legacyText?:string};
export type EmployeeDirectory = {id:string;employees:ProjectEmployee[];token:string;updatedAt:string};
export type CompanyProfile = {id:string;name:string;street:string;postalCode:string;city:string;country:string;phone:string;email:string;website:string;taxNumber:string;vatId:string;registerCourt:string;registerNumber:string;managingDirector:string;bankName:string;iban:string;bic:string;token:string;updatedAt:string};
export type EmployeeMember = {employeeId:string;name:string;code:string;trial:boolean};
export type TeamWork = {code:string;company:string;hourlyRate:number|null;workers:{name:string;hours:number|null;dailyHours?:Record<string,number>}[]};
export type ReportCrew = {id:string;team:string;employeeMembers:EmployeeMember[];teamWork:TeamWork|null;share:number};
export type ReportKind = 'measurement'|'extra'|'timesheet';
export type WorkerRole = 'fitter'|'foreman';
export type RoleRates = {costHourly:number|null;billingHourly:number|null;allowanceCost?:number|null;allowanceBilling?:number|null;travelCost:number;travelBilling:number|null;overnightCost:number;overnightBilling:number|null};
export type TimeRates = Record<WorkerRole,RoleRates>;
// Override/base fields below are retained only to read historical records.
// Editable time reports always use the project billing rates.
export type TimeEntry = {id:string;date:string;workerId:string;name:string;code:string;role:WorkerRole;start:string;end:string;pauseMinutes:number;task:string;billingHourlyOverride?:number|null;billingHourlyBase?:number|null;allowanceBillingOverride?:number|null;allowanceBillingBase?:number|null;allowanceQuantity?:number;travelQuantity:number;overnightQuantity:number;rates?:RoleRates};
export type TimeSheet = {mode:'day'|'week';anchorDate:string;factor:number;entries:TimeEntry[]};
export type Project = { id: string; name: string; foremanName?: string; number: string; orderNumber: string; customer: string; address: string; areas: string[]; teams?:ProjectTeam[]; employees?:ProjectEmployee[]; measurementEmail: string; invoiceEmail: string; cc: string; contact: string; contacts: string; contactPersons?:ProjectContact[]; factor: number; deadlineDays: number; deadlineType: 'calendar'|'working'; template: string; hourlyNote: boolean; timeRates?:TimeRates; archivedAt?:string; archivedByPlan?:boolean; planId?:string; updatedAt: string };
export type Position = { id: string; projectId: string; number: string; description: string; unit: string; price: number; longText: string; planned: number|null; isSupplement?: boolean };
export type Line = { id: string; positionId: string; number: string; description: string; unit: string; price: number; basePrice?:number;priceAdjustment?:number; employeePrice: number; employeeFactor?:number; quantity: number; remark: string; serviceDate?:string; workerId?:string; exactMinutes?:number };
export type Stage = 'created'|'approved'|'approved_changes'|'paid';
export type Report = { parentReportId?:string;crews?:ReportCrew[];revenueAllocation?:{customer:number;employee:number}; clientDraftId?:string; kind?:ReportKind; timeSheet?:TimeSheet; id: string; projectId: string; date: string; endDate: string; team: string; teamWork?:TeamWork|null; employeeMembers?:EmployeeMember[]; author?: string; area: string; note: string; lines: Line[]; state: 'draft'|'ready'; createdAt: string; updatedAt: string };
export type StoredFile = { orientationNormalized?:boolean;original?:{key:string;name:string;mime:string;size:number}; packageId?:string;reportIds?:string[]; id: string; projectId: string; reportId: string; kind: 'attachment'|'longtext'|'signed'|'package'; name: string; mime: string; size: number; key: string; createdAt: string };
export type Aggregate = { key: string; number: string; description: string; unit: string; price: number; employeePrice: number; employeeFactor?:number; quantity: number; customerValue: number; employeeValue: number };
export type Audit = {id:string; action:string; user:string; detail:string; at:string};
export type Data = { projects: Project[]; positions: Position[]; reports: Report[]; files: StoredFile[]; audit: Audit[]; employeeDirectory?:EmployeeDirectory; company?:CompanyProfile };
export const emptyData: Data = {projects:[],positions:[],reports:[],files:[],audit:[]};
