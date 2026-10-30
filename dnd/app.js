/* D&D party availability planner. Browser only; shared data is in Supabase with RLS. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const HALF_HOUR = 30 * 60 * 1000;
  const DAY = 24 * 60 * 60 * 1000;
  const MAX_PLAYERS = 12;
  const roomParams = new URLSearchParams(location.search);
  let roomId = roomParams.get('room');
  let inviteCode = roomParams.get('key');
  let api = null;
  let currentUser = null;
  let activeRoom = null;
  let players = [];
  let windows = [];
  let selectedQuickDay = null;
  let loading = false;
  let polling = null;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const dateFmt = new Intl.DateTimeFormat('ru-RU', { weekday:'short', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
  const timeFmt = new Intl.DateTimeFormat('ru-RU', { hour:'2-digit', minute:'2-digit' });
  const dayFmt = new Intl.DateTimeFormat('ru-RU', { day:'numeric', month:'short' });
  const weekdayFmt = new Intl.DateTimeFormat('ru-RU', { weekday:'short' });
  function clear(node) { node.replaceChildren(); return node; }
  function elem(tag, className, text) {
    const node=document.createElement(tag);
    if (className) node.className=className;
    if (text!==undefined) node.textContent=String(text);
    return node;
  }
  function setMessage(message) { $('inputMessage').textContent=message; }
  function report(err) {
    console.error(err);
    $('errorText').textContent=(err && err.message) ? err.message : String(err);
    $('errorPanel').hidden=false;
    $('connection').textContent='Ошибка подключения';
  }
  function safeStore(key,value) { try { localStorage.setItem(key,value); } catch (_) {} }
  function safeRead(key) { try { return localStorage.getItem(key) || ''; } catch (_) { return ''; } }
  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes=crypto.getRandomValues(new Uint8Array(16));
    bytes[6]=(bytes[6]&15)|64; bytes[8]=(bytes[8]&63)|128;
    const hex=[...bytes].map(v=>v.toString(16).padStart(2,'0')).join('');
    return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
  }
  function inviteSecret() {
    return [...crypto.getRandomValues(new Uint8Array(16))].map(v=>v.toString(16).padStart(2,'0')).join('');
  }
  function inviteURL() {
    const url=new URL(location.href);
    url.search='?room='+encodeURIComponent(roomId)+'&key='+encodeURIComponent(inviteCode);
    return url.toString();
  }
  function localDayDate(date) { return new Date(date.getFullYear(),date.getMonth(),date.getDate()); }
  function windowLabel(start,end) {
    const a=new Date(start),b=new Date(end);
    return dateFmt.format(a)+' — '+ (a.toDateString()===b.toDateString()?timeFmt.format(b):dateFmt.format(b));
  }
  // The selected day comes from the calendar strip. Time inputs contain
  // hours and minutes only, and stay unchanged when the player picks a day.
  function setInputsForDay(day) {
    selectedQuickDay=localDayDate(day);
    drawDaystrip();
  }
  function selectedTimeRange() {
    if (!selectedQuickDay) return null;
    const startText=$('startInput').value, endText=$('endInput').value;
    const clock=/^([01]\d|2[0-3]):([0-5]\d)$/;
    const s=clock.exec(startText), e=clock.exec(endText);
    if (!s || !e) return null;
    const startMinute=Number(s[1])*60+Number(s[2]);
    const endMinute=Number(e[1])*60+Number(e[2]);
    if(startMinute===endMinute) return null;
    const y=selectedQuickDay.getFullYear(),m=selectedQuickDay.getMonth(),d=selectedQuickDay.getDate();
    const start=new Date(y,m,d,Number(s[1]),Number(s[2]));
    const end=new Date(y,m,d+(endMinute<startMinute?1:0),Number(e[1]),Number(e[2]));
    return {start,end};
  }
  // Use calendar dates, not adding 24h in milliseconds: keeps local hours
  // stable even if the time zone switches daylight-saving offsets.
  function repeatIntervalsByDay(start,end,count) {
    const out=[];
    for(let i=0;i<count;i++){
      out.push({
        start:new Date(start.getFullYear(),start.getMonth(),start.getDate()+i,start.getHours(),start.getMinutes()),
        end:new Date(end.getFullYear(),end.getMonth(),end.getDate()+i,end.getHours(),end.getMinutes())
      });
    }
    return out;
  }
  function drawDaystrip() {
    const strip=clear($('daystrip'));
    const today=localDayDate(new Date());
    for(let i=0;i<14;i++) {
      const d=new Date(today.getFullYear(),today.getMonth(),today.getDate()+i);
      const button=elem('button','daychip'+(selectedQuickDay && d.getTime()===selectedQuickDay.getTime()?' active':''));button.type='button';
      const top=elem('small','',weekdayFmt.format(d)), day=elem('b','',String(d.getDate()));
      const bottom=elem('small','',new Intl.DateTimeFormat('ru-RU',{month:'short'}).format(d));
      button.append(top,day,bottom);
      button.addEventListener('click',()=>setInputsForDay(d));
      strip.appendChild(button);
    }
  }
  async function ensureAuth() {
    if (!api) throw new Error('Не подключена база Supabase.');
    let { data, error }=await api.auth.getUser();
    if (data && data.user) { currentUser=data.user; return; }
    const result=await api.auth.signInAnonymously();
    if (result.error) throw new Error('Не получается войти без пароля. Включи Anonymous Sign-Ins в Supabase. '+result.error.message);
    currentUser=result.data.user;
  }
  function busy(flag) {
    loading=flag;
    $('entryButton').disabled=flag;
    $('addWindow').disabled=flag;
    $('refresh').disabled=flag;
  }
  async function joinRoom(id,code,nickname) {
    const result=await api.rpc('join_room',{
      p_room_id:id,p_invite_code:code,p_nickname:nickname,p_timezone:timezone
    });
    if (result.error) throw result.error;
  }
  async function enter() {
    if (loading) return;
    const nickname=$('nicknameInput').value.trim();
    if (!nickname || nickname.length>32) { report(new Error('Укажи ник от 1 до 32 символов.')); return; }
    $('errorPanel').hidden=true;
    busy(true);
    try {
      await ensureAuth();
      if (!roomId) {
        const title=$('roomTitleInput').value.trim();
        if (!title || title.length>70) throw new Error('Название комнаты должно быть от 1 до 70 символов.');
        roomId=uuid(); inviteCode=inviteSecret();
        const insert=await api.from('dnd_rooms').insert({
          id:roomId,invite_code:inviteCode,title:title,meeting_minutes:180,created_by:currentUser.id
        });
        if (insert.error) throw insert.error;
      }
      await joinRoom(roomId,inviteCode,nickname);
      safeStore('dnd-scheduler-nick',nickname);
      history.replaceState(null,'',inviteURL());
      await showRoom();
    } catch (err) {
      report(err);
      if (!$('roomView').hidden) $('entryPanel').hidden=true;
    } finally { busy(false); }
  }
  async function showRoom() {
    $('entryPanel').hidden=true;
    $('roomView').hidden=false;
    $('myTimezone').textContent=timezone;
    $('myName').textContent=safeRead('dnd-scheduler-nick');
    const next=new Date();
    // Use tomorrow for the first suggestion if 19:00 has already passed today.
    const initial=new Date(next.getFullYear(),next.getMonth(),next.getDate()+(next.getHours()>=19?1:0));
    setInputsForDay(initial);
    await reload();
    if(polling) clearInterval(polling);
    polling=setInterval(()=>{if(!document.hidden && navigator.onLine) reload(true);},20000);
  }
  async function reload(silent=false) {
    if (!currentUser || !roomId) return;
    try {
      const [roomRes,membersRes,windowsRes]=await Promise.all([
        api.from('dnd_rooms').select('id,title,meeting_minutes,created_by').eq('id',roomId).single(),
        api.from('dnd_members').select('room_id,user_id,nickname,timezone,updated_at').eq('room_id',roomId),
        api.from('dnd_windows').select('id,room_id,user_id,start_at,end_at').eq('room_id',roomId)
      ]);
      if (roomRes.error) throw roomRes.error;
      if (membersRes.error) throw membersRes.error;
      if (windowsRes.error) throw windowsRes.error;
      activeRoom=roomRes.data;
      players=membersRes.data||[];
      windows=windowsRes.data||[];
      renderRoom();
      $('connection').textContent='● Данные синхронизированы';
      $('connection').className='top-badge ok';
      if(!silent) $('errorPanel').hidden=true;
    } catch (err) { if(!silent) report(err); else $('connection').textContent='Нет связи с базой'; }
  }
  function renderRoom() {
    $('roomTitle').textContent=activeRoom.title;
    $('roomCount').textContent=String(players.length)+' из '+String(MAX_PLAYERS);
    $('memberCount').textContent=String(players.length)+' / '+String(MAX_PLAYERS);
    const me=players.find(p=>p.user_id===currentUser.id);
    if(me) { $('myName').textContent=me.nickname;safeStore('dnd-scheduler-nick',me.nickname); }
    $('duration').value=String(activeRoom.meeting_minutes);
    $('duration').disabled=activeRoom.created_by!==currentUser.id;
    $('duration').title=activeRoom.created_by===currentUser.id?'Изменить длительность игры':'Продолжительность меняет создатель комнаты';
    renderMyWindows(); renderMembers(); renderMatches();
  }
  function renderMyWindows() {
    const mine=windows.filter(w=>w.user_id===currentUser.id).sort((a,b)=>new Date(a.start_at)-new Date(b.start_at));
    $('personalCount').textContent=String(mine.length)+' интервалов';
    const list=clear($('myWindows'));
    if(!mine.length) { list.append(elem('p','muted','Ты ещё не указал свободное время.'));return; }
    for(const w of mine) {
      const row=elem('div','window'), info=elem('div');
      info.append(elem('strong','',windowLabel(w.start_at,w.end_at)),elem('small','','Твоё местное время'));
      const remove=elem('button','remove','Удалить');remove.type='button';remove.setAttribute('aria-label','Удалить интервал');
      remove.addEventListener('click',()=>removeWindow(w.id,remove));
      row.append(info,remove);list.append(row);
    }
  }
  function renderMembers() {
    const list=clear($('people'));
    const counts=new Map();
    for(const w of windows) counts.set(w.user_id,(counts.get(w.user_id)||0)+1);
    for(const p of players) {
      const row=elem('div','person'), nameBox=elem('div');
      nameBox.append(elem('div','person-name',p.nickname+(p.user_id===currentUser.id?' (ты)':'')));
      nameBox.append(elem('div','person-detail',p.timezone || 'Часовой пояс не указан'));
      row.append(elem('span','avatar',p.nickname.slice(0,1).toUpperCase()),nameBox,elem('span','person-count',String(counts.get(p.user_id)||0)+' интервалов'));
      list.appendChild(row);
    }
  }
  function mergeWindows(ranges) {
    const sorted=ranges.map(w=>({a:new Date(w.start_at).getTime(),b:new Date(w.end_at).getTime()})).sort((a,b)=>a.a-b.a);
    const out=[];
    for(const r of sorted) {
      const last=out[out.length-1];
      if(last && r.a<=last.b) last.b=Math.max(last.b,r.b);
      else out.push({...r});
    }
    return out;
  }
  function computeMatches() {
    if(!players.length) return [];
    const byUser=new Map(players.map(p=>[p.user_id,mergeWindows(windows.filter(w=>w.user_id===p.user_id))]));
    const needed=activeRoom.meeting_minutes*60000;
    const first=Math.ceil(Date.now()/HALF_HOUR)*HALF_HOUR;
    const end=first+21*DAY;
    const results=[];
    for(let t=first;t+needed<=end;t+=HALF_HOUR) {
      const yes=players.filter(p=>(byUser.get(p.user_id)||[]).some(r=>r.a<=t && r.b>=t+needed));
      if(yes.length) results.push({start:t,end:t+needed,yes:yes,score:yes.length});
    }
    results.sort((a,b)=>b.score-a.score || a.start-b.start);
    const picks=[],perDay=new Map();
    for(const r of results) {
      const date=new Date(r.start);
      const dayKey=[date.getFullYear(),date.getMonth(),date.getDate()].join('-');
      if((perDay.get(dayKey)||0)>=2) continue;
      picks.push(r);perDay.set(dayKey,(perDay.get(dayKey)||0)+1);
      if(picks.length>=10) break;
    }
    return picks;
  }
  function renderMatches() {
    const wrap=clear($('results'));
    if(!windows.length) {
      wrap.append(elem('div','empty','Когда игроки отметят свободные часы, здесь появятся варианты для совместной игры.'));
      return;
    }
    const matches=computeMatches();
    if(!matches.length) {
      wrap.append(elem('div','empty','Пока нет даже частичных совпадений на ближайшие 21 день. Добавьте больше свободных часов.'));
      return;
    }
    const total=players.length;
    const full=matches.filter(m=>m.score===total);
    if(full.length) wrap.append(elem('div','muted','🎉 Есть время, когда вся пати может собраться!'));
    else wrap.append(elem('div','muted','Полного совпадения пока нет. Ближайшие варианты:'));
    for(const m of matches) {
      const complete=m.score===total;
      const card=elem('div','result'+(complete?' perfect':'')),row=elem('div','result-title');
      row.append(elem('b','',windowLabel(m.start,m.end)),elem('span','score',String(m.score)+' / '+String(total)+(complete?' · ВСЕ!':'')));
      const possible=m.yes.map(p=>p.nickname).join(', ');
      const missing=players.filter(p=>!m.yes.some(a=>a.user_id===p.user_id)).map(p=>p.nickname).join(', ');
      card.append(row,elem('p','who','Могут: '+possible+(missing?' · Не отметили это время: '+missing:'')));
      wrap.append(card);
    }
  }
  async function addWindow() {
    if(loading) return;
    const chosen=selectedTimeRange();
    if(!chosen) {setMessage('Укажи разные часы начала и конца (например, 18:00–23:00).');return;}
    const {start,end}=chosen;
    const days=Number($('repeatCount').value);
    if(![1,2,3,4,5,7].includes(days)) {setMessage('Выбери количество дней.');return;}
    const ranges=repeatIntervalsByDay(start,end,days);
    if(ranges.some(r=>r.end-r.start<HALF_HOUR || r.end-r.start>DAY)) {
      setMessage('Интервал должен быть от 30 минут до 24 часов в каждом дне.');return;
    }
    if(ranges.some(r=>r.start.getTime()<Date.now()-HALF_HOUR)) {
      setMessage('Нельзя добавлять время в прошлом. Выбери другую дату.');return;
    }
    const mine=windows.filter(w=>w.user_id===currentUser.id);
    const already=new Set(mine.map(w=>new Date(w.start_at).getTime()+'|'+new Date(w.end_at).getTime()));
    const fresh=ranges.filter(r=>!already.has(r.start.getTime()+'|'+r.end.getTime()));
    if(!fresh.length) {setMessage('✓ Это время уже добавлено для всех выбранных дней.');return;}
    if(mine.length+fresh.length>100) {setMessage('Лимит: 100 интервалов на игрока. Уменьши число дней.');return;}
    busy(true);setMessage('Сохраняем '+fresh.length+' интервалов…');
    try {
      const entries=fresh.map(r=>({
        room_id:roomId,user_id:currentUser.id,
        start_at:r.start.toISOString(),end_at:r.end.toISOString()
      }));
      const result=await api.from('dnd_windows').insert(entries);
      if(result.error) throw result.error;
      await reload();
      const skipped=days-fresh.length;
      setMessage('✓ Сохранено '+fresh.length+' интервалов.'+(skipped?' Пропущено уже существующих: '+skipped+'.':'')+' Игроки увидят их автоматически.');
    } catch(err) {setMessage('Ошибка: '+err.message);}finally{busy(false);}
  }
  async function removeWindow(id,button) {
    button.disabled=true;
    try {
      const res=await api.from('dnd_windows').delete().eq('id',id).eq('user_id',currentUser.id);
      if(res.error)throw res.error;
      await reload();
      setMessage('Интервал удалён.');
    }catch(err){setMessage('Ошибка удаления: '+err.message);button.disabled=false;}
  }
  async function changeDuration() {
    if(!activeRoom || activeRoom.created_by!==currentUser.id)return;
    const minutes=Number($('duration').value);
    if(![120,180,240].includes(minutes))return;
    $('duration').disabled=true;
    try{
      const res=await api.from('dnd_rooms').update({meeting_minutes:minutes}).eq('id',roomId);
      if(res.error)throw res.error;
      await reload();
    }catch(err){report(err);}finally{$('duration').disabled=false;}
  }
  async function changeName() {
    const prev=$('myName').textContent;
    const next=window.prompt('Новый ник (до 32 символов):',prev);
    if(next===null)return;
    const nickname=next.trim();
    if(!nickname||nickname.length>32){window.alert('Ник должен содержать от 1 до 32 символов.');return;}
    const res=await api.from('dnd_members').update({nickname,timezone,updated_at:new Date().toISOString()}).eq('room_id',roomId).eq('user_id',currentUser.id);
    if(res.error){report(res.error);return;}
    safeStore('dnd-scheduler-nick',nickname);
    await reload();
  }
  async function copyLink() {
    const url=inviteURL();
    try{
      await navigator.clipboard.writeText(url);
      $('copyInvite').textContent='✓ Ссылка скопирована';
      setTimeout(()=>$('copyInvite').textContent='Скопировать приглашение',2400);
    }catch(_){window.prompt('Скопируй ссылку для друзей:',url);}
  }
  function start() {
    $('retry').addEventListener('click',()=>location.reload());
    $('entryButton').addEventListener('click',enter);
    $('addWindow').addEventListener('click',addWindow);
    $('copyInvite').addEventListener('click',copyLink);
    $('editNickname').addEventListener('click',changeName);
    $('refresh').addEventListener('click',()=>reload());
    $('duration').addEventListener('change',changeDuration);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden && currentUser)reload(true);});
    window.addEventListener('online',()=>{if(currentUser)reload(true);});
    $('nicknameInput').value=safeRead('dnd-scheduler-nick');
    $('myTimezone').textContent=timezone;
    if(roomId && (!/^[a-f0-9-]{36}$/i.test(roomId)||!/^[a-f0-9]{32}$/i.test(inviteCode||''))) {
      roomId=null;inviteCode=null;
      $('errorText').textContent='Неправильная ссылка-приглашение. Попроси создателя отправить ссылку целиком.';
      $('errorPanel').hidden=false;
    }
    if(roomId) {
      $('entryTitle').textContent='Присоединиться к пати';
      $('entryHint').textContent='Введите ник. Сайт сам узнает ваш часовой пояс и переведёт время встречи.';
      $('createFields').hidden=true;
      $('entryButton').textContent='Войти в комнату';
    }
    const config=window.DND_SUPABASE_CONFIG||{};
    const valid=/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(config.url||'') && typeof config.publishableKey==='string' && config.publishableKey.length>20;
    if(!valid) {
      $('setupNotice').hidden=false;
      $('entryPanel').hidden=true;
      $('connection').textContent='Ожидает подключения базы';
      return;
    }
    if(!window.supabase || typeof window.supabase.createClient!=='function') {
      $('connection').textContent='Нет связи с библиотекой';
      report(new Error('Не загрузилась библиотека Supabase. Проверь соединение с интернетом.'));
      return;
    }
    api=window.supabase.createClient(config.url,config.publishableKey,{
      auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}
    });
    $('connection').textContent='Онлайн';
    $('entryPanel').hidden=false;
    // A guest nick is still required on the room page, never silently invent a player.
  }
  start();
})();
