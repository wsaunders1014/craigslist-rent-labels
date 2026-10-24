const fs=require('fs'),vm=require('vm'),assert=require('assert');
const hooks=[];
class Marker {
 constructor(info){this.options={clMarkerInfo:info};this.events={};this.el={handlers:{},addEventListener(k,f){this.handlers[k]=f},children:[],classes:new Set(),classList:{remove:c=>this.el.classes.delete(c),add:c=>this.el.classes.add(c)},querySelector:()=>this.el.children[0],append:n=>{n.remove=()=>this.el.children.splice(this.el.children.indexOf(n),1);this.el.children.push(n)},setAttribute:(k,v)=>this.el[k]=v};hooks.forEach(h=>h.call(this));}
 static addInitHook(h){hooks.push(h)}
 on(k,f){this.events[k]=f}
 getElement(){return this.el}
 setIcon(){this.el.children=[];return this}
}
let tick; const window={handlers:{},addEventListener(k,f){this.handlers[k]=f}};const sandbox=vm.createContext({window,document:{createElement:()=>({children:[],attrs:{},style:{setProperty(){}},setAttribute(k,v){this.attrs[k]=v},getAttribute(k){return this.attrs[k]},append(e){this.children.push(e)},set textContent(v){this.value=v},get textContent(){return this.children.length?this.children.map(x=>x.textContent).join('\n'):this.value}})},setInterval:f=>{tick=f},URL,location:{href:"https://www.craigslist.org/search/apa"},console});
for(const file of ['src/core.js','src/adapters/craigslist.js'])vm.runInContext(fs.readFileSync(require('path').join(__dirname,file),'utf8'),sandbox,{filename:file});
window.L={Marker};
const info={visibleCount:1,searchResult:{price:'$2,575',postingTitle:'Apartment'}};
const m=new Marker(info);m.events.add();assert.equal(m.el.children[0].textContent,'$2,575');assert(m.el['aria-label'].includes('Apartment'));
assert.equal(m.setIcon(),m);assert.equal(m.el.children.length,1);
info.visibleCount=0;m.setIcon();assert.equal(m.el.children.length,0);
const group=new Marker({visibleCount:1,visiblePids:[42],getSearchResultByPid:()=>({price:3200})});group.events.add();assert.equal(group.el.children[0].textContent,'$3,200');
for(const price of [undefined,0,'unavailable']){const x=new Marker({visibleCount:1,searchResult:{price}});x.events.add();assert.equal(x.el.children.length,0)}
window.L=window.L;assert.equal(hooks.length,1);
for (const [bedrooms, expected] of [[1,'$2,000 · 1 Br'],['2','$2,000 · 2 Br'],[0,'$2,000 · Studio'],['studio','$2,000 · Studio'],[undefined,'$2,000'],['','$2,000']]) {
 const x=new Marker({visibleCount:1,searchResult:{price:2000,bedrooms}});x.events.add();assert.equal(x.el.children[0].textContent,expected);
}
const late={price:2000};const x=new Marker({visibleCount:1,searchResult:late});x.events.add();late.bedrooms=1;tick();assert.equal(x.el.children[0].textContent,'$2,000 · 1 Br');
for (const result of [
 {price:2000, kwargs:{bedrooms:0}, get bedrooms(){return undefined}},
 {price:2000, postingTitle:'Bright studio in Santa Monica'},
 {price:2000, _bedrooms:0}
]) {const x=new Marker({visibleCount:1,searchResult:result});x.events.add();assert.equal(x.el.children[0].textContent,'$2,000 · Studio')}
const one=new Marker({visibleCount:1,searchResult:{price:2000,bedrooms:1,postingTitle:'1 bedroom near studio'}});one.events.add();assert.equal(one.el.children[0].textContent,'$2,000 · 1 Br');
const units=Array.from({length:20},(_,i)=>new Marker({visibleCount:1,searchResult:{pid:100+i,price:2000+i,bedrooms:1}}));
class Cluster extends Marker {getAllChildMarkers(){return this.units||[]}}
const cluster=new Cluster();cluster.units=units;cluster.events.add();assert.equal(cluster.el.children[0].textContent.split('\n').length,4);assert(cluster.el.children[0].textContent.endsWith('+17 more'));
cluster.units=units.slice(0,3);tick();assert.equal(cluster.el.children[0].textContent,'$2,000 · 1 Br\n$2,001 · 1 Br\n$2,002 · 1 Br');
cluster.units=units.slice(0,2);tick();assert.equal(cluster.el.children[0].textContent.split('\n').length,2);
cluster.units=[];tick();assert.equal(cluster.el.children.length,0);
const reposts=Array.from({length:5},(_,i)=>new Marker({visibleCount:1,searchResult:{pid:200+i,price:2000,bedrooms:1,postingTitle:i%2?' Bright Apartment ':'bright apartment',lat:34.05,lng:-118.5,sqft:700}}));
cluster.units=reposts;cluster.events.add();assert.equal(cluster.el.children[0].textContent,'$2,000 · 1 Br');
cluster.units=[...reposts,new Marker({visibleCount:1,searchResult:{pid:300,price:2000,bedrooms:1,postingTitle:'Different apartment',lat:34.05,lng:-118.5,sqft:750}})];tick();assert.equal(cluster.el.children[0].children.length,2);
cluster.units.push(new Marker({visibleCount:1,searchResult:{pid:301,price:2000,bedrooms:1,postingTitle:'bright apartment',lat:34.06,lng:-118.5,sqft:700}}));tick();assert.equal(cluster.el.children[0].children.length,3);
cluster.units.push(new Marker({visibleCount:1,searchResult:{pid:302,price:2000,bedrooms:1,postingTitle:'bright apartment',lat:34.05,lng:-118.5,sqft:800}}));tick();assert(cluster.el.children[0].textContent.endsWith('+1 more'));
const photoUnits=Array.from({length:3},(_,i)=>new Marker({visibleCount:1,searchResult:{pid:400+i,price:2995,bedrooms:2,postingTitle:['Lovely Unit','Incredible Apt','Stunning Apartment'][i],lat:34.05,lng:-118.5,imageIds:['same-photo']}}));
cluster.units=photoUnits;tick();assert.equal(cluster.el.children[0].children.length,1);
cluster.units.push(new Marker({visibleCount:1,searchResult:{pid:500,price:3100,bedrooms:2,postingTitle:'Other unit',lat:34.05,lng:-118.5,imageIds:['same-photo']}}));tick();assert.equal(cluster.el.children[0].children.length,2);
cluster.units.push(new Marker({visibleCount:1,searchResult:{pid:501,price:2995,bedrooms:2,postingTitle:'Another unit',lat:34.06,lng:-118.5,imageIds:['same-photo']}}));tick();assert.equal(cluster.el.children[0].children.length,3);
const addressUnits=['2001 Olympic Boulevard, Santa Monica, CA','2001 Olympic Blvd, Santa Monica, CA'].map((description,i)=>new Marker({visibleCount:1,searchResult:{pid:600+i,price:2080,bedrooms:0,sqft:360,postingTitle:'Different title '+i,lat:34.02,lng:-118.48,imageIds:['different'+i],location:{description}}}));
cluster.units=addressUnits;tick();assert.equal(cluster.el.children[0].children.length,1);
for (const unit of ['1','2'])cluster.units.push(new Marker({visibleCount:1,searchResult:{pid:700+Number(unit),price:2080,bedrooms:0,sqft:360,postingTitle:'Same title',lat:34.02,lng:-118.48,imageIds:['shared-photo'],location:{description:'2001 Olympic Blvd Apt '+unit}}}));
tick();assert.equal(cluster.el.children[0].children.length,3);
cluster.units.push(new Marker({visibleCount:1,searchResult:{pid:800,price:2100,bedrooms:0,sqft:360,postingTitle:'Another',lat:34.02,lng:-118.48,location:{description:'2001 Olympic Blvd'}}}));tick();assert(cluster.el.children[0].textContent.endsWith('+1 more'));
const spam=Array.from({length:62},(_,i)=>new Marker({visibleCount:1,searchResult:{pid:1000+i,price:2080,bedrooms:i%2?undefined:0,sqft:360,postingTitle:'Marketing title '+i,lat:34.02+(i%3)*.00002,lng:-118.48,imageIds:['photo-'+i]}}));
cluster.units=spam;tick();assert.equal(cluster.el.children[0].children.length,1);
cluster.units.push(new Marker({visibleCount:1,searchResult:{pid:2000,price:2080,bedrooms:0,sqft:400,postingTitle:'Larger',lat:34.02,lng:-118.48}}));tick();assert.equal(cluster.el.children[0].children.length,2);
cluster.units.push(new Marker({visibleCount:1,searchResult:{pid:2001,price:2080,bedrooms:0,sqft:360,postingTitle:'Elsewhere',lat:34.03,lng:-118.48}}));tick();assert.equal(cluster.el.children[0].children.length,3);
let opened=0, stopped=0, defaultPrevented=0, popupPanel;
window.L.popup=()=>({setLatLng(){return this},setContent(panel){popupPanel=panel;return this},openOn(map){assert.equal(map,cluster._map);opened++;return this}});
cluster._map={};cluster.getLatLng=()=>({lat:34,lng:-118});cluster.units=[new Marker({visibleCount:1,searchResult:{pid:3000,price:2080,bedrooms:0,sqft:360,postingTitle:'Studio',url:'https://www.craigslist.org/view/d/studio/test'}})];cluster.events.add();
cluster.el.handlers.click({type:'click',preventDefault(){defaultPrevented++},stopImmediatePropagation(){stopped++}});assert.equal(opened,1);assert.equal(stopped,1);assert.equal(defaultPrevented,1);assert.equal(popupPanel.children[0].textContent,'1 offer');assert.equal(popupPanel.children[1].href,'https://www.craigslist.org/view/d/studio/test');
cluster.el.handlers.keydown({type:'keydown',key:'Escape'});assert.equal(opened,1);
window.handlers.message({source:window,data:{type:'crl-settings',groupClick:'zoom'}});
cluster.el.handlers.click({type:'click',preventDefault(){throw Error('Zoom click blocked')},stopImmediatePropagation(){throw Error('Zoom propagation blocked')}});assert.equal(opened,1);
window.handlers.message({source:window,data:{type:'crl-settings',groupClick:'list'}});
cluster.el.handlers.click({type:'click',preventDefault(){},stopImmediatePropagation(){}});assert.equal(opened,2);
cluster.units=units;
window.handlers.message({source:window,data:{type:'crl-settings',maxRows:2}});assert.equal(cluster.el.children[0].children.length,3);assert(cluster.el.children[0].textContent.endsWith('+18 more'));
window.handlers.message({source:window,data:{type:'crl-settings',maxRows:0}});assert(cluster.el.children[0].textContent.endsWith('+18 more'));
window.handlers.message({source:window,data:{type:'crl-settings',maxRows:20}});assert.equal(cluster.el.children[0].children.length,20);
// Possible rooms and coliving.
const roomUnits=[
 new Marker({visibleCount:1,searchResult:{pid:5000,price:1500,bedrooms:1,postingTitle:'Private room in 3br house',url:'https://www.craigslist.org/view/a'}}),
 new Marker({visibleCount:1,searchResult:{pid:5001,price:1550,bedrooms:0,postingTitle:'Sunny studio',url:'https://www.craigslist.org/view/b'}})];
cluster.units=roomUnits;tick();
assert.equal(cluster.el.children[0].textContent,'$1,550 · Studio\n$1,500 · 1 Br · Room?','tag mode lists possible rooms last');
assert.equal(cluster.el.children[0].children[1].className,'crl-listing-row crl-flagged');
window.handlers.message({source:window,data:{type:'crl-settings',roomFilter:'dim'}});
assert.equal(cluster.el.children[0].children[1].className,'crl-listing-row crl-flagged crl-dimmed');
window.handlers.message({source:window,data:{type:'crl-settings',roomFilter:'hide'}});
assert.equal(cluster.el.children[0].textContent,'$1,550 · Studio');
cluster.el.handlers.click({type:'click',preventDefault(){},stopImmediatePropagation(){}});
assert.equal(popupPanel.children[0].textContent,'1 offer · 1 possible room hidden');
const loneRoom=new Marker({visibleCount:1,searchResult:{pid:5002,price:1400,postingTitle:'Coliving suite, all utilities'}});loneRoom.events.add();
assert.equal(loneRoom.el.children.length,0);assert(loneRoom.el.classes.has('crl-hidden-marker'),'hidden rooms hide the native dot');
window.handlers.message({source:window,data:{type:'crl-settings',roomFilter:'off'}});
assert.equal(cluster.el.children[0].textContent,'$1,500 · 1 Br\n$1,550 · Studio');
assert(!loneRoom.el.classes.has('crl-hidden-marker'));assert.equal(loneRoom.el.children[0].textContent,'$1,400');
window.handlers.message({source:window,data:{type:'crl-settings',roomFilter:'hide'}});
sandbox.location.href='https://losangeles.craigslist.org/search/santa-monica-ca/roo';tick();
assert.equal(cluster.el.children[0].textContent,'$1,500 · 1 Br\n$1,550 · Studio','rooms & shares searches never filter');
window.handlers.message({source:window,data:{type:'crl-settings',roomFilter:'nonsense'}});
sandbox.location.href='https://www.craigslist.org/search/apa';tick();
assert.equal(cluster.el.children[0].textContent,'$1,550 · Studio','invalid modes are ignored');
console.log('Passed: aggregate clusters, three-row cap, count changes; Craigslist zero-bedroom getter and explicit studio titles; bedrooms, studios, missing counts, delayed bedrooms; Leaflet assignment, single prices, icon replacement, cluster counts, one-visible-item groups, missing prices, duplicate-hook prevention; room filter tag, dim, hide and off modes, hidden native dots, rooms & shares exemption.');
