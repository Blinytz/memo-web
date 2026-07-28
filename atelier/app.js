import { ImageEditor } from './image-editor.js';

const REPO='Blinytz/memo-web',BRANCH='main',API=`https://api.github.com/repos/${REPO}`;
const token=()=>sessionStorage.getItem('memoGithubToken')||'';
const headers=()=>({'Authorization':`Bearer ${token()}`,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'});
const repoUrl=value=>new URL(`../${String(value||'').replace(/^\/+/,'')}`,import.meta.url).href;
const assetUrl=value=>{const raw=String(value||'');return !raw?'':raw.startsWith('data:')||/^https?:|^blob:/i.test(raw)?raw:repoUrl(raw)};
const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statuses=['manquante','importee','a_cadrer','a_verifier','validee','verrouillee','source_cassee','conflit'];
const state={data:null,categoryId:'',listId:'',entryId:null,dirty:false,imageDirty:false,editor:null};

function status(text){$('#status').textContent=text}
function currentList(){return state.data.lists.find(list=>list.id===state.listId)}
function visibleEntries(){
  const query=$('#search').value.trim().toLowerCase(),filter=$('#status-filter').value;
  return state.data.entries.filter(entry=>{
    if(entry.deletedAt||entry.listId!==state.listId)return false;
    const imageStatus=entry.image?.status||'manquante';
    if(filter==='a_traiter'&&!['manquante','a_cadrer','a_verifier','source_cassee','conflit'].includes(imageStatus))return false;
    if(filter==='validee'&&imageStatus!=='validee')return false;
    if(filter==='verrouillee'&&!entry.image?.locked)return false;
    return !query||`${entry.number} ${entry.name} ${entry.title} ${entry.subtitle}`.toLowerCase().includes(query);
  }).sort((a,b)=>a.order-b.order);
}
function listEntries(){return state.data.entries.filter(e=>e.listId===state.listId&&!e.deletedAt).sort((a,b)=>a.order-b.order)}

async function load(){
  try{
    const response=await fetch(`${repoUrl('data/atelier/workspace.json')}?t=${Date.now()}`,{cache:'no-store'});
    if(!response.ok)throw new Error(`Données indisponibles (${response.status})`);
    state.data=await response.json();
    state.categoryId=state.data.categories.find(c=>!c.deletedAt)?.id||'';
    state.listId=state.data.lists.find(l=>!l.deletedAt&&(!state.categoryId||l.categoryId===state.categoryId))?.id||state.data.lists.find(l=>!l.deletedAt)?.id;
    statuses.forEach(s=>$('#f-status').add(new Option(s.replaceAll('_',' '),s)));
    renderFilters();renderGrid();
    status(token()?'GitHub connecté':'lecture seule · connecter GitHub');
  }catch(error){console.error(error);status('erreur de chargement');alert('Impossible de charger les données Mémo.')}
}

function renderFilters(){
  $('#category-filter').innerHTML=state.data.categories.filter(c=>!c.deletedAt).sort((a,b)=>a.order-b.order).map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  $('#category-filter').value=state.categoryId;
  const lists=state.data.lists.filter(l=>!l.deletedAt&&(!state.categoryId||l.categoryId===state.categoryId)).sort((a,b)=>a.order-b.order);
  $('#list-filter').innerHTML=lists.map(l=>`<option value="${esc(l.id)}">${esc(l.icon||'')} ${esc(l.name)} (${listCount(l.id)})</option>`).join('');
  if(!lists.some(l=>l.id===state.listId))state.listId=lists[0]?.id||'';
  $('#list-filter').value=state.listId;
}
function listCount(id){return state.data.entries.filter(e=>e.listId===id&&!e.deletedAt).length}
function imageBadge(entry){
  if(entry.image?.locked)return '<span class="v-statut ok">🔒</span>';
  if(entry.image?.status==='validee')return '<span class="v-statut ok">✓</span>';
  if(['manquante','source_cassee','conflit'].includes(entry.image?.status))return '<span class="v-statut warn">!</span>';
  return '';
}
function renderGrid(){
  const list=currentList(),entries=visibleEntries();
  $('#list-title').textContent=list?.name||'Liste';
  $('#metrics').textContent=`${entries.length} entrée${entries.length>1?'s':''} affichée${entries.length>1?'s':''} · cliquez sur une carte pour modifier immédiatement`;
  $('#grid').innerHTML=entries.map(entry=>`<button class="vignette" data-entry="${esc(entry.id)}">
    ${imageBadge(entry)}
    ${entry.image?.thumb?`<img loading="lazy" src="${esc(assetUrl(entry.image.thumb))}" alt="">`:'<span class="sans-image">＋</span>'}
    <span class="v-nom">${esc(entry.name)}</span>
    <span class="v-meta">N° ${esc(entry.number)} · ${esc((entry.image?.status||'manquante').replaceAll('_',' '))}</span>
  </button>`).join('')||'<p>Aucune entrée pour ces filtres.</p>';
}

async function openEntry(id){
  const entry=state.data.entries.find(e=>e.id===id);if(!entry)return;
  state.entryId=id;state.imageDirty=false;
  $('#editeur').hidden=false;document.body.style.overflow='hidden';
  $('#ed-name').textContent=entry.name;$('#ed-info').textContent=`${currentList()?.name||''} · n° ${entry.number}`;
  for(const [id,key] of [['f-number','number'],['f-name','name'],['f-title','title'],['f-subtitle','subtitle'],['f-description','description'],['f-extra','extraText'],['f-wiki','wikipedia']])$('#'+id).value=entry[key]||'';
  $('#f-status').value=entry.image?.status||'manquante';$('#f-locked').checked=!!entry.image?.locked;
  $('#dynamic-fields').innerHTML=Object.entries(entry.fields||{}).map(([key,value])=>`<label>${esc(key)}<input data-dynamic="${esc(key)}" value="${esc(value)}"></label>`).join('');
  state.editor||=new ImageEditor($('#image-frame'),$('#image-source'),$('#image-preview'),()=>{if(state.entryId)state.imageDirty=true});
  $('#image-source').removeAttribute('src');$('#image-empty').hidden=!!entry.image?.source;
  if(entry.image?.source){
    try{await state.editor.load(assetUrl(entry.image.source));state.editor.setCrop(entry.image.crop);state.imageDirty=false}
    catch{$('#image-empty').hidden=false}
  }
  const entries=listEntries(),index=entries.findIndex(e=>e.id===id);
  $('#ed-prev').disabled=index<=0;$('#ed-next').disabled=index<0||index>=entries.length-1;
  $('#editeur').scrollTop=0;
}
function closeEditor(){state.entryId=null;$('#editeur').hidden=true;document.body.style.overflow='';renderGrid()}
function markDirty(){state.dirty=true;status('modifications en cours')}
function syncFields(){
  const entry=state.data.entries.find(e=>e.id===state.entryId);if(!entry)return;
  for(const [id,key] of [['f-number','number'],['f-name','name'],['f-title','title'],['f-subtitle','subtitle'],['f-description','description'],['f-extra','extraText'],['f-wiki','wikipedia']])entry[key]=$('#'+id).value;
  entry.image.status=$('#f-status').value;entry.image.locked=$('#f-locked').checked;
  document.querySelectorAll('[data-dynamic]').forEach(input=>entry.fields[input.dataset.dynamic]=input.value);
  $('#ed-name').textContent=entry.name;markDirty();
}

async function githubCommit(files,message){
  if(!token()){$('#github-dialog').showModal();throw new Error('Connectez GitHub pour enregistrer.')}
  const refResponse=await fetch(`${API}/git/ref/heads/${BRANCH}`,{headers:headers(),cache:'no-store'});
  if(!refResponse.ok)throw new Error(`Connexion GitHub refusée (${refResponse.status})`);
  const parent=(await refResponse.json()).object.sha;
  const commit=await (await fetch(`${API}/git/commits/${parent}`,{headers:headers()})).json();
  const tree=[];
  for(const file of files){
    const blob=await fetch(`${API}/git/blobs`,{method:'POST',headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify({content:file.base64||btoa(unescape(encodeURIComponent(file.text))),encoding:'base64'})});
    if(!blob.ok)throw new Error(`Échec du fichier ${file.path}`);
    tree.push({path:file.path,mode:'100644',type:'blob',sha:(await blob.json()).sha});
  }
  const treeResponse=await fetch(`${API}/git/trees`,{method:'POST',headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify({base_tree:commit.tree.sha,tree})});
  const commitResponse=await fetch(`${API}/git/commits`,{method:'POST',headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify({message,tree:(await treeResponse.json()).sha,parents:[parent]})});
  const sha=(await commitResponse.json()).sha;
  const update=await fetch(`${API}/git/refs/heads/${BRANCH}`,{method:'PATCH',headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify({sha,force:false})});
  if(!update.ok)throw new Error('Conflit : rechargez la page avant de réessayer.');
}
const blob64=blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(blob)});
async function saveCurrent(){
  const entry=state.data.entries.find(e=>e.id===state.entryId),files=[];
  if(entry&&state.imageDirty&&state.editor?.source){
    const output=await state.editor.exports(),base=`assets/atelier/${entry.id}`;
    entry.image.source=`${base}/original.webp`;entry.image.full=`${base}/full.webp`;entry.image.thumb=`${base}/thumb.webp`;entry.image.crop=state.editor.crop();entry.image.status=entry.image.locked?'verrouillee':'importee';entry.image.provenance={kind:'manual',at:new Date().toISOString()};
    files.push({path:`${base}/original.webp`,base64:await blob64(output.original)},{path:`${base}/full.webp`,base64:await blob64(output.full)},{path:`${base}/thumb.webp`,base64:await blob64(output.thumb)});
  }
  state.data.revision=Number(state.data.revision||0)+1;state.data.updatedAt=new Date().toISOString();
  files.push({path:'data/atelier/workspace.json',text:JSON.stringify(state.data,null,2)+'\n'});
  await githubCommit(files,entry?`Atelier Mémo : ${entry.name}`:'Atelier Mémo : mise à jour');
  state.dirty=false;state.imageDirty=false;status('enregistré sur GitHub');
}

async function saveWithFeedback(){try{status('enregistrement…');await saveCurrent();if(state.entryId)await openEntry(state.entryId)}catch(error){status('erreur');alert(error.message)}}
function navigate(delta){const entries=listEntries(),index=entries.findIndex(e=>e.id===state.entryId),target=entries[index+delta];if(target)openEntry(target.id)}
async function loadFile(file){if(!file)return;await state.editor.load(URL.createObjectURL(file));$('#image-empty').hidden=true;state.imageDirty=true;markDirty()}
function renderNotes(){
  $('#notes-list').innerHTML=state.data.notes.map(n=>`<div class="note"><b>${esc(n.status)} · ${esc(n.priority)}</b><p>${esc(n.text)}</p><small>${n.targets.entryIds.length} entrée(s)</small></div>`).join('')||'<p>Aucune note.</p>';
}

$('#category-filter').onchange=e=>{state.categoryId=e.target.value;renderFilters();renderGrid()};
$('#list-filter').onchange=e=>{state.listId=e.target.value;renderGrid()};
$('#status-filter').onchange=renderGrid;$('#search').oninput=renderGrid;
$('#grid').onclick=e=>{const id=e.target.closest('[data-entry]')?.dataset.entry;if(id)openEntry(id)};
$('#ed-close').onclick=closeEditor;$('#ed-prev').onclick=()=>navigate(-1);$('#ed-next').onclick=()=>navigate(1);
$('#ed-save').onclick=saveWithFeedback;$('#save').onclick=saveWithFeedback;
document.querySelectorAll('#f-number,#f-name,#f-title,#f-subtitle,#f-description,#f-extra,#f-wiki,#f-status,#f-locked').forEach(control=>control.oninput=syncFields);
$('#dynamic-fields').oninput=syncFields;
$('#img-minus').onclick=()=>state.editor.zoom(1/1.15);$('#img-plus').onclick=()=>state.editor.zoom(1.15);$('#img-fill').onclick=()=>state.editor.fill();$('#img-contain').onclick=()=>state.editor.contain();
$('#img-file').onclick=()=>$('#img-input').click();$('#img-input').onchange=e=>loadFile(e.target.files[0]);
$('#image-frame').ondragover=e=>e.preventDefault();$('#image-frame').ondrop=e=>{e.preventDefault();loadFile(e.dataTransfer.files[0])};
window.addEventListener('paste',e=>{if($('#editeur').hidden)return;const file=[...e.clipboardData.items].find(i=>i.type.startsWith('image/'))?.getAsFile();if(file)loadFile(file)});
$('#add-row').onclick=()=>{const entries=listEntries(),entry={id:crypto.randomUUID(),listId:state.listId,number:String(entries.length+1),name:'Nouvelle entrée',title:'Nouvelle entrée',subtitle:'',description:'',extraText:'',wikipedia:'',fields:{},order:entries.length,deletedAt:null,externalIds:{},image:{source:null,full:null,thumb:null,crop:{cx:.5,cy:.5,w:1},status:'manquante',locked:false,provenance:{}}};state.data.entries.push(entry);markDirty();openEntry(entry.id)};
$('#duplicate-row').onclick=()=>{const source=state.data.entries.find(e=>e.id===state.entryId);if(!source)return;const copy=structuredClone(source);copy.id=crypto.randomUUID();copy.name+=` (copie)`;copy.number=String(listEntries().length+1);copy.order=listEntries().length;copy.image.locked=false;state.data.entries.push(copy);markDirty();openEntry(copy.id)};
$('#trash-row').onclick=()=>{const entry=state.data.entries.find(e=>e.id===state.entryId);if(entry&&confirm(`Supprimer « ${entry.name} » ?`)){entry.deletedAt=new Date().toISOString();state.data.trash.push({type:'entry',id:entry.id,at:entry.deletedAt});markDirty();closeEditor()}};
$('#renumber').onclick=()=>{const start=Number(prompt('Premier numéro',1));if(!start)return;listEntries().forEach((e,i)=>e.number=String(start+i));markDirty();renderGrid()};
$('#notes-view').onclick=()=>{renderNotes();$('#notes-dialog').showModal()};$('#bulk-note').onclick=$('#entry-note').onclick=()=>{renderNotes();$('#notes-dialog').showModal()};
$('#note-add').onclick=()=>{const text=$('#note-text').value.trim();if(!text)return;state.data.notes.push({id:crypto.randomUUID(),text,targets:{entryIds:state.entryId?[state.entryId]:[],listIds:state.entryId?[]:[state.listId]},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),status:$('#note-status').value,priority:$('#note-priority').value});$('#note-text').value='';markDirty();renderNotes()};
document.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>button.closest('dialog').close());
$('#github-settings').onclick=()=>{$('#github-token').value=token();$('#github-dialog').showModal()};
$('#github-connect').onclick=async()=>{const value=$('#github-token').value.trim();sessionStorage.setItem('memoGithubToken',value);const response=await fetch(API,{headers:headers()});if(!response.ok){sessionStorage.removeItem('memoGithubToken');return alert('Jeton refusé ou accès insuffisant.')}$('#github-dialog').close();status('GitHub connecté')};
window.addEventListener('beforeunload',event=>{if(state.dirty||state.imageDirty){event.preventDefault();event.returnValue=''}});

load();
