"use strict";

(() => {
  const categories = { merch: "周边小物", new: "食品与优惠", meet: "亲子活动" };
  const storageKey = "mai-calendar-real-concept-v2";
  const reminders = { none: "不设置提醒", "previous-day": "前一天上午 9 点", "same-day": "当天上午 9 点" };
  let catalog;
  try { catalog = CampaignCatalog.build(ActivitySnapshot); }
  catch (error) {
    document.getElementById("dataError").textContent = "活动快照未能读取，请刷新页面重试。";
    document.getElementById("dataError").hidden = false;
    document.getElementById("listHint").textContent = "活动数据暂时无法读取。";
    return;
  }
  let events = catalog.items;
  let months = [...new Set([catalog.source.queriedAt.slice(0, 7), ...events.filter((event) => CampaignCatalog.canExport(event)).map((event) => event.date.slice(0, 7))])].sort();
  const monthName = (month) => `${Number(month.slice(5))} 月`;
  let validIds = new Set(events.filter((event) => CampaignCatalog.canExport(event)).map((event) => event.id));
  const $ = (id) => document.getElementById(id);
  const state = { month: months[0], view: "ready", category: "all", day: null, selected: new Set(), reminder: "none" };
  let localConnected = false;
  let initializing = location.protocol !== "file:";
  let updating = false;
  let pendingSaves = 0;
  let serverRevision = 0;
  let serverSelected = [];
  let preparedAt = null;
  let mutationQueue = Promise.resolve();
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const weekday = (date) => "日一二三四五六"[new Date(`${date}T00:00:00Z`).getUTCDay()];
  const shortDate = (date) => `${Number(date.slice(5, 7))} 月 ${Number(date.slice(8, 10))} 日`;
  const timeLabel = (event) => `${event.startTime} 正式开售`;
  const dateLabel = (event) => event.date
    ? `${shortDate(event.date)}（周${weekday(event.date)}）· ${timeLabel(event)}`
    : "开售时间待核实";
  const onDate = (event, date) => event.date === date;
  const selectedEvents = () => [...state.selected].map((id) => serverSelected.find((event) => event.id === id) || events.find((event) => event.id === id)).filter(Boolean);
  const exportableEvents = () => selectedEvents().filter((event) => event.syncState !== "pending" && CampaignCatalog.canExport(event));
  const monthEvents = () => events.filter((event) => (event.date || catalog.source.queriedAt).slice(0, 7) === state.month);
  const calendarEvents = () => monthEvents().filter((event) => CampaignCatalog.canExport(event));

  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (saved && Array.isArray(saved.selected)) state.selected = new Set(saved.selected.filter((id) => validIds.has(id)));
      if (saved && Object.hasOwn(reminders, saved.reminder)) state.reminder = saved.reminder;
    } catch {
      // Selection remains usable when storage is unavailable or corrupted.
    }
  }

  function save() {
    try { localStorage.setItem(storageKey, JSON.stringify({ selected: [...state.selected], reminder: state.reminder })); }
    catch { /* No storage permission is needed to select or export events. */ }
    if (!localConnected) return;
    const input = { selected: [...state.selected], reminder: state.reminder };
    pendingSaves++;
    renderConnection();
    mutationQueue = mutationQueue.then(async () => {
      const response = await request("/api/preferences", { ...input, revision: serverRevision });
      serverRevision = response.revision;
      serverSelected = response.selectedEvents;
    }).catch(async (error) => {
      showUpdate(error.message, true);
      try { adopt(await request("/api/state")); }
      catch { localConnected = false; }
    }).finally(() => {
      pendingSaves--;
      if (!pendingSaves) renderAll();
      renderConnection();
    });
  }

  async function request(url, input) {
    let response;
    try {
      response = await fetch(url, { cache: "no-store", ...(input ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) } : {}), signal: AbortSignal.timeout(8000) });
    } catch { throw new Error("本地服务未能连接。原数据已保留；请启动服务后刷新页面，订阅尚未更新。"); }
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || "操作未完成，原数据已保留。");
    return body;
  }

  function adopt(response) {
    catalog = CampaignCatalog.build(response.snapshot);
    events = catalog.items;
    serverSelected = response.selectedEvents;
    state.selected = new Set(response.selected);
    state.reminder = response.reminder;
    serverRevision = response.revision;
    preparedAt = response.preparedAt;
    months = [...new Set([catalog.source.queriedAt.slice(0, 7), ...events.filter((e) => e.date).map((e) => e.date.slice(0, 7))])].sort();
    validIds = new Set(events.filter((event) => CampaignCatalog.canExport(event)).map((event) => event.id));
    if (!months.includes(state.month)) { state.month = months[0]; state.day = null; }
    try { localStorage.setItem(storageKey, JSON.stringify({ selected: response.selected, reminder: response.reminder })); } catch { /* Server remains authoritative. */ }
  }

  function showUpdate(message, error = false) {
    $("updateStatus").textContent = message;
    $("updateStatus").classList.toggle("error", error);
  }

  function renderConnection() {
    const busy = initializing || updating || pendingSaves > 0;
    const synchronized = selectedEvents().filter((e) => e.syncState !== "pending").length;
    $("updateActivities").disabled = !localConnected || busy;
    $("importSnapshot").disabled = !localConnected || busy;
    $("demoUpdate").hidden = catalog.source.mode !== "demo";
    $("demoUpdate").disabled = !localConnected || busy;
    $("updateActivities").textContent = updating ? "正在更新…" : "更新活动";
    $("preparedNotice").textContent = localConnected
      ? preparedAt ? `已准备的查询快照：${preparedAt}（北京时间）` : "还没有新的查询快照。"
      : initializing ? "正在连接本地服务…" : "订阅需要本地服务。请双击文件夹中的“启动麦日历.command”，再打开本地预览地址。";
    $("subscribeCalendar").disabled = !localConnected || busy || synchronized === 0;
    $("mobileExportButton").disabled = localConnected ? $("subscribeCalendar").disabled : exportableEvents().length === 0;
    $("reminder").disabled = initializing || updating;
    $("subscriptionStatus").textContent = !localConnected ? "本地订阅尚未连接；可继续下载一次性文件。"
      : pendingSaves ? "正在保存选择，订阅稍后更新…"
      : synchronized ? `已保存 · 本地订阅含 ${synchronized} 项活动，等待 Mac 刷新。` : "先挑选活动，再订阅到这台 Mac。";
  }

  async function initializeLocal() {
    if (location.protocol === "file:") { renderConnection(); return; }
    try {
      const previousSelection = [...state.selected];
      const previousReminder = state.reminder;
      let response = await request("/api/state");
      const available = new Set(CampaignCatalog.build(response.snapshot).items.filter((e) => CampaignCatalog.canExport(e)).map((e) => e.id));
      if (!response.initialized && (previousSelection.length || previousReminder !== "none")) {
        response = await request("/api/preferences", { selected: previousSelection.filter((id) => available.has(id)), reminder: previousReminder, revision: response.revision });
      }
      adopt(response);
      localConnected = true;
    } catch (error) { showUpdate(error.message, true); }
    finally { initializing = false; renderAll(); renderConnection(); }
  }

  async function updateActivities() {
    if (!localConnected || updating || pendingSaves) return;
    updating = true;
    renderConnection();
    try {
      const previousRevision = serverRevision;
      const response = await request("/api/updates", { revision: serverRevision });
      adopt(response);
      const summary = response.lastUpdate;
      showUpdate(response.revision === previousRevision ? `已是这份最新快照，${state.selected.size} 项选择仍然保留。`
        : `已更新至 ${catalog.source.queriedAt}；新增 ${summary.added} 项，内容变化 ${summary.changed} 项，保留 ${summary.retained} 项选择。${summary.missing ? `本次未出现 ${summary.missing} 项，不视为取消。` : ""}`);
    } catch (error) { showUpdate(error.message, true); }
    finally { updating = false; renderAll(); renderConnection(); }
  }

  async function prepareSnapshot(route, snapshot) {
    if (!localConnected || updating || pendingSaves) return;
    updating = true; renderConnection();
    try {
      const response = await request(route, { revision: serverRevision, ...(snapshot ? { snapshot } : {}) });
      adopt(response);
      showUpdate(`${route === "/api/demo-updates" ? "虚构演示改期" : "快照"}已准备：${preparedAt}。点击“更新活动”应用；当前活动与选择尚未改变。`);
    } catch (error) { showUpdate(error.message, true); }
    finally { updating = false; renderAll(); }
  }

  function illustration(name) {
    const shapes = {
      stickers: '<rect x="12" y="15" width="35" height="38" rx="5" fill="#fffbeb" transform="rotate(-10 30 34)"/><path d="m18 39 11-17 13 17Zm6-1v9h11v-9" fill="#cb6650"/><path d="M38 14h15v20H38z" fill="#9aaa8a" transform="rotate(12 46 24)"/><circle cx="45" cy="22" r="4" fill="#f6e3a3"/>',
      coffee: '<path d="M16 23h29v23a7 7 0 0 1-7 7H23a7 7 0 0 1-7-7Z" fill="#fffbeb" stroke="#596b55" stroke-width="1.6"/><path d="M45 28h4c10 0 10 14 0 14h-4M12 55h37M23 17c-5-5 5-7 1-12m12 12c-5-5 5-7 1-12" stroke="#596b55" stroke-width="1.6" fill="none" stroke-linecap="round"/><path d="M22 32h16" stroke="#bf6e50" stroke-width="3"/>',
      apron: '<path d="M21 17v10L12 39l5 16h30l5-16-9-12V17Z" fill="#fffbeb" stroke="#896857" stroke-width="1.6"/><path d="M22 17c0-14 20-14 20 0M25 35h15v12H25zM8 30l10 5m29 0 10-5" stroke="#896857" stroke-width="1.6" fill="none" stroke-linecap="round"/><circle cx="32" cy="27" r="3" fill="#c66b50"/>',
      burger: '<path d="M10 28c1-24 43-24 44 0Z" fill="#d99b48" stroke="#6e5a37" stroke-width="1.5"/><path d="M10 43h44v6c0 7-44 7-44 0Z" fill="#d99b48" stroke="#6e5a37" stroke-width="1.5"/><rect x="9" y="33" width="46" height="8" rx="4" fill="#87644f"/><path d="m10 29 7 5 7-4 8 5 8-5 7 4 7-5" fill="none" stroke="#718252" stroke-width="3"/><path d="m22 18 2-2m8 2 2-2m7 4 2-2" stroke="#ffedbe" stroke-width="2" stroke-linecap="round"/>',
      bag: '<path d="m17 23-3 33h36l-3-33Z" fill="#fffbeb" stroke="#607373" stroke-width="1.6"/><path d="M24 28V16c0-13 16-13 16 0v12" stroke="#607373" stroke-width="2" fill="none"/><path d="m26 39 6-7 6 7-6 7Z" fill="#ca7351"/><path d="M23 50h18" stroke="#b2b6a7" stroke-width="1.5"/>',
      pencil: '<rect x="12" y="16" width="34" height="39" rx="2" fill="#fffbeb" transform="rotate(-9 29 35)"/><path d="M20 30h15M20 36h10M20 44h17" stroke="#b6aa8d" stroke-width="2" stroke-linecap="round"/><path d="m33 44 17-29 6 4-17 29-9 5Z" fill="#c7784c" stroke="#806353" stroke-width="1.3"/><path d="m50 15 3-5 6 4-3 5" fill="#7c9379" stroke="#806353" stroke-width="1.3"/>',
      star: '<circle cx="32" cy="14" r="7" fill="none" stroke="#76573f" stroke-width="2"/><path d="M32 22v6" stroke="#76573f" stroke-width="2"/><path d="m32 27 6 10 12 2-9 8 2 12-11-6-11 6 2-12-9-8 12-2Z" fill="#f3d778" stroke="#76573f" stroke-width="1.5"/><path d="m29 39-3 5" stroke="#fff5cf" stroke-width="2" stroke-linecap="round"/>',
      notebook: '<rect x="17" y="10" width="33" height="46" rx="3" fill="#fffbeb" stroke="#706746" stroke-width="1.5"/><path d="M23 11v44M13 20h9m-9 12h9m-9 12h9" stroke="#706746" stroke-width="2" stroke-linecap="round"/><path d="M30 24h13M30 32h9M30 40h11" stroke="#bc7651" stroke-width="2" stroke-linecap="round"/>',
    };
    return `<svg viewBox="0 0 64 64" aria-hidden="true">${shapes[name]}</svg>`;
  }

  function renderActivities() {
    const visible = monthEvents().filter((event) => (state.view === "all" || CampaignCatalog.canExport(event)) && (state.category === "all" || event.category === state.category) && (!state.day || onDate(event, state.day)));
    $("visibleCount").textContent = visible.length;
    $("listHint").textContent = state.day
      ? `${shortDate(state.day)} · ${visible.length} 项活动`
      : `${monthName(state.month)} · ${visible.length} 项${state.view === "ready" ? "时间已核实，可挑选" : "去重后的活动内容"}`;
    $("clearFilters").hidden = state.category === "all" && !state.day;
    $("emptyState").hidden = visible.length !== 0;
    $("activityList").innerHTML = visible.map((event) => {
      const eligible = CampaignCatalog.canExport(event);
      const picked = state.selected.has(event.id) && eligible;
      const status = eligible ? "时间已核实" : event.status === "past" ? "已开售 · 仅浏览" : "时间待核实";
      const tag = eligible ? "label" : "div";
      const evidence = event.timeEvidence ? `<p>开售依据：${escapeHtml(event.timeEvidence)}</p>` : "";
      const buttonEvidence = event.buttonTimes.filter(Boolean).length ? `<p>提醒按钮文案：${escapeHtml([...new Set(event.buttonTimes.filter(Boolean))].join(" / "))}</p>` : "";
      return `<li><article class="event-card${picked ? " selected" : ""}${eligible ? "" : " browse-only"}" data-event="${escapeHtml(event.id)}">
        <${tag} class="event-select-area">
          ${eligible ? `<input class="sr-only" type="checkbox" value="${escapeHtml(event.id)}" ${picked ? "checked" : ""} ${initializing || updating ? "disabled" : ""} aria-label="选择活动：${escapeHtml(event.title)}，${escapeHtml(dateLabel(event))}">` : ""}
          <span class="event-poster" style="--poster-color:${event.color}">${illustration(event.art)}<small>${event.sourceMode === "demo" ? "FICTIONAL DEMO" : event.category === "merch" ? "LIMITED DROP" : "OFFICIAL INFO"}</small></span>
          <span class="event-info"><span class="event-meta"><span class="category-badge">${categories[event.category]}</span><span class="verification-badge ${eligible ? "verified" : ""}">${status}</span></span>
            <span class="event-title" role="heading" aria-level="3">${escapeHtml(event.title)}</span>
            <span class="event-date">${escapeHtml(dateLabel(event))}</span>
            <span class="event-description">${escapeHtml(event.description)}</span>
            <span class="event-place">${escapeHtml(eligible ? `${event.earlyAccess ? `${event.earlyAccess}；` : ""}日历记录正式开售时间。` : event.reason)}</span>
          </span>
          ${eligible ? `<span class="event-choice" aria-hidden="true"><span class="check-circle">${picked ? "✓" : "+"}</span><span class="check-caption">${picked ? "已选" : "挑选"}</span></span>` : ""}
        </${tag}>
        <details class="event-details"><summary>查看时间依据与${event.sourceMode === "demo" ? "演示" : "官方"}文案</summary>
          <div class="event-evidence">${evidence}${buttonEvidence}<p>${escapeHtml(event.reason)}</p><p>列表展示日期：${escapeHtml(event.displayDates.map(shortDate).join("、") || "未给出")}。这不是新的开售日期。</p><p>来源：${event.sourceMode === "demo" ? "虚构演示" : "官方活动信息"}，${escapeHtml(event.sourceTime)}。</p></div>
          <p class="original-copy">${escapeHtml(event.content)}</p>
        </details>
      </article></li>`;
    }).join("");
    document.querySelectorAll(".filter").forEach((button) => {
      const active = button.dataset.category === state.category;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    document.querySelectorAll(".availability-tab").forEach((button) => {
      const active = button.dataset.view === state.view;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    $("monthLabel").textContent = `${state.month.slice(0, 4)} 年 ${Number(state.month.slice(5))} 月`;
    $("previousMonth").disabled = state.month === months[0];
    $("nextMonth").disabled = state.month === months.at(-1);
  }

  function renderMonth() {
    const [year, month] = state.month.split("-").map(Number);
    const leading = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const cells = Array.from({ length: leading }, () => '<span class="calendar-blank" aria-hidden="true"></span>');
    for (let day = 1; day <= days; day++) {
      const date = `${state.month}-${String(day).padStart(2, "0")}`;
      const dayEvents = calendarEvents().filter((event) => onDate(event, date));
      const selected = dayEvents.some((event) => state.selected.has(event.id));
      const active = state.day === date;
      const label = `${shortDate(date)}，${dayEvents.length} 项活动${selected ? "，含已选活动" : ""}`;
      cells.push(`<button class="calendar-day${dayEvents.length ? " has-events" : ""}${selected ? " has-selection" : ""}${active ? " active-date" : ""}" type="button" data-date="${date}" aria-label="${label}" aria-pressed="${active}" ${dayEvents.length ? "" : "disabled"}>${day}</button>`);
    }
    $("monthGrid").innerHTML = cells.join("");
    $("calendar-heading").textContent = `${monthName(state.month)}，一眼看全`;
  }

  function updateMonthSelection() {
    $("monthGrid").querySelectorAll("button[data-date]").forEach((button) => {
      const dayEvents = calendarEvents().filter((event) => onDate(event, button.dataset.date));
      const selected = dayEvents.some((event) => state.selected.has(event.id));
      button.classList.toggle("has-selection", selected);
      button.setAttribute("aria-label", `${shortDate(button.dataset.date)}，${dayEvents.length} 项活动${selected ? "，含已选活动" : ""}`);
    });
  }

  function renderSelection() {
    const selected = selectedEvents();
    $("selectedCount").textContent = selected.length;
    $("selectionEmpty").hidden = selected.length > 0;
    $("selectionList").hidden = selected.length === 0;
    $("selectionList").innerHTML = selected.map((event) => `<li class="selection-item">
      <span class="selection-date" aria-hidden="true"><span>${Number(event.date.slice(5, 7))}月</span><b>${Number(event.date.slice(8))}</b></span>
      <div><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(dateLabel(event))}${event.syncNote ? `<br>${escapeHtml(event.syncNote)}` : ""}</small></div>
      <button class="remove-button" type="button" data-remove="${event.id}" aria-label="移除${escapeHtml(event.title)}">×</button></li>`).join("");
    $("exportButton").disabled = exportableEvents().length === 0;
    $("mobileExportButton").disabled = selected.length === 0;
    $("clearSelection").disabled = selected.length === 0;
    $("exportButton").firstElementChild.textContent = "下载一次性文件";
    $("mobileSelectionCount").textContent = selected.length ? `已选 ${selected.length} 项活动` : "尚未选择活动";
    $("reminder").value = state.reminder;
    $("dialogReminder").value = state.reminder;
  }

  function updateSelection(id, selected) {
    if (initializing || updating) { renderAll(); return; }
    const eligible = events.find((event) => event.id === id) || serverSelected.find((event) => event.id === id);
    if (!eligible || (selected && !CampaignCatalog.canExport(eligible))) return;
    if (selected) state.selected.add(id);
    else state.selected.delete(id);
    const card = document.querySelector(`.event-card[data-event="${CSS.escape(id)}"]`);
    if (card && card.querySelector("input")) {
      card.classList.toggle("selected", selected);
      card.querySelector("input").checked = selected;
      card.querySelector(".check-circle").textContent = selected ? "✓" : "+";
      card.querySelector(".check-caption").textContent = selected ? "已选" : "挑选";
    }
    save();
    renderSelection();
    updateMonthSelection();
    const event = eligible;
    $("announcement").textContent = `${selected ? "已选择" : "已取消"}${event.title}。共选择 ${state.selected.size} 项活动。`;
  }

  function renderAll() {
    renderActivities(); renderMonth(); renderSelection(); renderConnection();
    const demo = catalog.source.mode === "demo";
    $("activityList").setAttribute("aria-label", demo ? "虚构活动列表" : "活动列表");
    $("sourceStamp").textContent = demo ? "虚构演示" : "真实活动";
    $("sourceNotice").textContent = demo ? `以下活动全部虚构，仅供体验 · ${catalog.source.queriedAt}（北京时间）生成。` : `来自手动导入的官方活动快照 · 查询于 ${catalog.source.queriedAt}（北京时间）。活动需手动更新。`;
    $("updateNote").textContent = demo ? "选一项虚构活动，再点“演示改期”和“更新活动”，体验同一日程改期、保留选择。导入真实快照前先取消演示选择。" : "在已配置麦当劳 MCP 的 AI 工具中手动查询一次活动，导出公开字段 JSON，再导入快照并更新。这里不会后台取数。";
    $("exportDialog").querySelector(".dialog-warning").textContent = demo ? "这些活动与日期全部虚构，不代表麦当劳官方活动。建议放入单独的演示日历。" : "这些是按官方文案核对的开售提醒，参与条件与后续变更请以官方为准。建议放入单独的麦日历日历。";
    $("readyTab").textContent = `可加入日历 · ${catalog.stats.ready}`;
    $("allTab").textContent = `浏览全部 · ${catalog.stats.uniqueItems}`;
    $("catalogSummary").textContent = `本次 ${catalog.stats.displayEntries} 条展示记录，合并 ${catalog.stats.mergedEntries} 条重复后保留 ${catalog.stats.uniqueItems} 项内容；不代表 ${catalog.stats.uniqueItems} 场独立活动。`;
  }
  function clearFilters(showAll = false) {
    if (showAll) state.view = "all";
    state.category = "all";
    state.day = null;
    renderActivities();
    renderMonth();
    $("announcement").textContent = "已显示本月全部活动。";
  }

  function openPreview() {
    const selected = exportableEvents();
    if (!selected.length) return;
    $("exportPreview").innerHTML = selected.map((event) => `<li><strong>${escapeHtml(event.title)}开售</strong><small>${escapeHtml(dateLabel(event))}<br>${escapeHtml(event.earlyAccess || "")}<br>来源：${event.sourceMode === "demo" ? "虚构演示" : "官方活动文案"} · ${escapeHtml(event.sourceTime)}</small></li>`).join("");
    $("exportDescription").textContent = `这 ${selected.length} 项活动将生成一个日历文件，由你确认导入。`;
    $("dialogReminder").value = state.reminder;
    $("importStep").hidden = true;
    $("exportError").hidden = true;
    $("downloadCalendar").textContent = "下载日历文件";
    $("exportDialog").showModal();
  }

  function downloadCalendar() {
    let url;
    let link;
    try {
      const selected = exportableEvents();
      const file = CalendarFile.create(selected, state.reminder);
      url = URL.createObjectURL(new Blob([file], { type: "text/calendar;charset=utf-8" }));
      link = document.createElement("a");
      link.href = url;
      link.download = catalog.source.mode === "demo" ? "麦日历-虚构演示.ics" : "麦日历-真实活动.ics";
      document.body.appendChild(link);
      link.click();
      $("exportedCount").textContent = selected.length;
      $("importStep").hidden = false;
      $("downloadCalendar").textContent = "重新下载文件";
      $("exportError").hidden = true;
      $("importStep").scrollIntoView({ block: "nearest", behavior: "auto" });
    } catch (error) {
      $("exportError").textContent = `文件暂时无法生成：${error.message} 请重新挑选活动后再试。`;
      $("exportError").hidden = false;
    } finally {
      if (link) link.remove();
      if (url) window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
  }

  document.querySelectorAll(".filter").forEach((button) => button.addEventListener("click", () => {
    state.category = button.dataset.category;
    renderActivities();
    $("announcement").textContent = `已筛选${button.textContent}，当前显示 ${$("visibleCount").textContent} 项活动。`;
  }));
  $("activityList").addEventListener("change", (event) => {
    if (event.target.matches('input[type="checkbox"]')) updateSelection(event.target.value, event.target.checked);
  });
  $("monthGrid").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-date]");
    if (!button || button.disabled) return;
    state.day = state.day === button.dataset.date ? null : button.dataset.date;
    renderActivities();
    renderMonth();
    $("monthGrid").querySelector(`button[data-date="${button.dataset.date}"]`).focus();
    $("announcement").textContent = state.day ? `已筛选${shortDate(state.day)}的活动。` : "已取消日期筛选。";
  });
  $("selectionList").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-remove]");
    if (!button) return;
    const index = [...$("selectionList").querySelectorAll("button")].indexOf(button);
    updateSelection(button.dataset.remove, false);
    const remaining = $("selectionList").querySelectorAll("button");
    if (remaining.length) remaining[Math.min(index, remaining.length - 1)].focus();
    else document.querySelector(".filter.active").focus();
  });
  $("clearSelection").addEventListener("click", () => {
    [...state.selected].forEach((id) => updateSelection(id, false));
    $("announcement").textContent = "已清空所选活动。";
    document.querySelector(".filter.active").focus();
  });
  for (const [id, offset] of [["previousMonth", -1], ["nextMonth", 1]]) {
    $(id).addEventListener("click", () => {
      const next = months[months.indexOf(state.month) + offset];
      if (!next) return;
      state.month = next;
      state.day = null;
      renderAll();
      $(id === "nextMonth" ? "previousMonth" : "nextMonth").focus();
      $("announcement").textContent = `已切换到${monthName(state.month)}，你的选择仍然保留。`;
    });
  }
  for (const id of ["reminder", "dialogReminder"]) {
    $(id).addEventListener("change", (event) => {
      state.reminder = event.target.value;
      save();
      $("reminder").value = state.reminder;
      $("dialogReminder").value = state.reminder;
      if ($("exportDialog").open) {
        $("importStep").hidden = true;
        $("downloadCalendar").textContent = "下载日历文件";
      }
      $("announcement").textContent = `提醒已设为：${reminders[state.reminder]}。`;
    });
  }
  $("clearFilters").addEventListener("click", () => clearFilters());
  $("showAllActivities").addEventListener("click", () => { clearFilters(true); document.querySelector(".filter.active").focus(); });
  $("exportButton").addEventListener("click", openPreview);
  $("mobileExportButton").addEventListener("click", () => localConnected ? openSubscription() : openPreview());
  $("closeDialog").addEventListener("click", () => $("exportDialog").close());
  $("exportDialog").addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || event.ctrlKey || event.altKey || event.metaKey) return;
    const controls = [...$("exportDialog").querySelectorAll("button:not([disabled]), select:not([disabled])")]
      .filter((control) => control.getClientRects().length > 0);
    const first = controls[0];
    const last = controls.at(-1);
    // Keep the preview's focus cycle inside the dialog, including browser-chrome boundaries.
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  $("exportDialog").addEventListener("click", (event) => {
    const bounds = $("exportDialog").getBoundingClientRect();
    if (event.target === $("exportDialog") && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) $("exportDialog").close();
  });
  $("downloadCalendar").addEventListener("click", downloadCalendar);
  document.querySelectorAll(".availability-tab").forEach((button) => button.addEventListener("click", () => {
    state.view = button.dataset.view;
    state.day = null;
    renderActivities();
    renderMonth();
    $("announcement").textContent = `${button.textContent}，当前显示 ${$("visibleCount").textContent} 项活动。`;
  }));
  function openSubscription() {
    if ($("subscribeCalendar").disabled) return;
    $("subscriptionUrl").value = `${location.origin}/calendar.ics`;
    $("copyStatus").textContent = "";
    $("subscriptionDialog").showModal();
  }
  $("subscribeCalendar").addEventListener("click", openSubscription);
  $("closeSubscription").addEventListener("click", () => $("subscriptionDialog").close());
  $("subscriptionDialog").addEventListener("close", () => $("subscribeCalendar").focus());
  $("subscriptionDialog").addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const controls = [...$("subscriptionDialog").querySelectorAll("button,input")];
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  $("copySubscription").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("subscriptionUrl").value); $("copyStatus").textContent = "地址已复制。"; }
    catch { $("subscriptionUrl").select(); $("copyStatus").textContent = "请按 Command+C 复制已选中的地址。"; }
  });
  $("updateActivities").addEventListener("click", updateActivities);
  $("demoUpdate").addEventListener("click", () => prepareSnapshot("/api/demo-updates"));
  $("importSnapshot").addEventListener("click", () => $("snapshotFile").click());
  $("snapshotFile").addEventListener("change", async (event) => {
    const file = event.target.files[0]; event.target.value = "";
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { showUpdate("快照超过 2 MiB，原活动与选择已保留。", true); return; }
    let snapshot;
    try { snapshot = JSON.parse(await file.text()); } catch { showUpdate("快照不是有效 JSON，原活动与选择已保留。", true); return; }
    await prepareSnapshot("/api/snapshots", snapshot);
  });
  restore();
  renderAll();
  initializeLocal();
})();
