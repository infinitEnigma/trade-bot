export type ResidualEvidence={kind:"parsed";quantity:string;symbol:string}|{kind:"unparsed"}|{kind:"ambiguous"};
export function parseResidualEvidence(raw:string):ResidualEvidence{
 const marker=raw.indexOf("cleanup_incomplete");if(marker<0)return{kind:"unparsed"};
 const detail=raw.slice(marker+"cleanup_incomplete".length).replace(/^\s*[:;]/,"").trim();
 const patterns=[/position\s+(\d+(?:\.\d+)?)\s+([A-Za-z0-9._/-]+)\s+not flattened\b/gi,/position\s+(\d+(?:\.\d+)?)\s+([A-Za-z0-9._/-]+)\s+still open\b/gi,/position\s+(\d+(?:\.\d+)?)\s+([A-Za-z0-9._/-]+)\s+not verified\b/gi,/position re-read failed after flatten slices\s*\(last seen\s+(\d+(?:\.\d+)?)\s+([A-Za-z0-9._/-]+)\)/gi];
 const pairs:Array<{quantity:string;symbol:string}>=[];
 for(const pattern of patterns)for(const match of detail.matchAll(pattern))pairs.push({quantity:match[1],symbol:match[2]});
 if(!pairs.length)return{kind:"unparsed"};const first=pairs[0];
 if(pairs.some(x=>x.quantity!==first.quantity||x.symbol.toLowerCase()!==first.symbol.toLowerCase()))return{kind:"ambiguous"};
 return{kind:"parsed",...first};
}