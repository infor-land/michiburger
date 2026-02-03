// assets/js/app.js
// UI móvil tipo Asana + integración con Asana API + cifrado (nombres, descripciones, comentarios y adjuntos)

import {
  initStore,
  getVisibleItems,
  updateItemField,
  getState,
  setGlobalFilter
} from "./store.js";
import { cryptoManager } from "./crypto-utils.js";

const ASANA_API_BASE = "https://app.asana.com/api/1.0";

// Estado UI
let currentWorkspaceId = null;
let currentProjectId = null;
let currentProjectName = "";
let currentSelectedTaskId = null;
let currentDetailTaskId = null;

// Referencias DOM
const dom = {};

/* =============================
   Helpers binarios <-> base64
============================= */

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToArrayBuffer(b64) {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/* =============================
   Helper contraseña cifrado
============================= */

function syncCryptoPassword() {
  if (!dom.cryptoPassword) return;
  const pw = dom.cryptoPassword.value.trim();
  cryptoManager.setMasterPassword(pw || null);
  console.log("[Crypto] masterPassword configurada:", !!cryptoManager.masterPassword);
}

/* =============================
   Bootstrap
============================= */

document.addEventListener("DOMContentLoaded", () => {
  cacheDom();
  attachEvents();
});

/* =============================
   Inicialización DOM
============================= */

function cacheDom() {
  dom.headerProjectLabel = document.getElementById("projectNameLabel");

  dom.openSearchBtn = document.getElementById("openSearchBtn");
  dom.openConfigBtn = document.getElementById("openConfigBtn");
  dom.searchBar = document.getElementById("searchBar");
  dom.globalFilter = document.getElementById("globalFilter");

  dom.asanaConfigPanel = document.getElementById("asanaConfigPanel");
  dom.asanaToken = document.getElementById("asanaToken");
  dom.asanaWorkspace = document.getElementById("asanaWorkspace");
  dom.asanaProject = document.getElementById("asanaProject");
  dom.cryptoPassword = document.getElementById("cryptoPassword");
  dom.loadTasksBtn = document.getElementById("loadTasksBtn");

  dom.taskList = document.getElementById("taskList");
  dom.fabMain = document.getElementById("fabMain");

  dom.detailsModal = document.getElementById("detailsModal");
  dom.closeDetailsBtn = document.getElementById("closeDetailsBtn");
  dom.detailTitle = document.getElementById("detailTitle");
  dom.detailTags = document.getElementById("detailTags");
  dom.detailDescription = document.getElementById("detailDescription");
  dom.saveDescriptionBtn = document.getElementById("saveDescriptionBtn");
  dom.commentsList = document.getElementById("commentsList");
  dom.commentForm = document.getElementById("commentForm");
  dom.commentInput = document.getElementById("commentInput");
  dom.attachmentsList = document.getElementById("attachmentsList");
  dom.attachmentInput = document.getElementById("attachmentInput");
}

/* =============================
   Eventos UI
============================= */

/* =============================
   Loader global
============================= */
function showLoader(msg = "Cargando...") {
  const loader = document.getElementById("globalLoader");
  if (!loader) return;
  loader.querySelector(".loader-text").textContent = msg;
  loader.classList.remove("hidden");
}

function hideLoader() {
  const loader = document.getElementById("globalLoader");
  if (!loader) return;
  loader.classList.add("hidden");
}



function attachEvents() {
	
	// Guardar descripción
	dom.saveDescriptionBtn.addEventListener("click", async () => {
	  if (!currentDetailTaskId) return;
	  try {
		await saveDescription(currentDetailTaskId);
	  } catch (err) {
		console.error(err);
		alert("No se pudo guardar la descripción.");
	  }
	});	
	
  // Mostrar/ocultar barra de búsqueda
  dom.openSearchBtn.addEventListener("click", () => {
    const hidden = dom.searchBar.classList.toggle("hidden");
    if (!hidden) {
      dom.globalFilter.focus();
    }
  });

  // Mostrar/ocultar panel de config Asana
  dom.openConfigBtn.addEventListener("click", () => {
    const hidden = dom.asanaConfigPanel.classList.toggle("hidden");
    if (!hidden && dom.asanaToken.value.trim()) {
      if (!dom.asanaWorkspace.options.length) {
        loadWorkspaces().catch(console.error);
      }
    }
  });

  // Buscar en tiempo real
  dom.globalFilter.addEventListener("input", () => {
    setGlobalFilter(dom.globalFilter.value);
    renderTaskList();
  });

  // Cambio de workspace → cargar proyectos
  dom.asanaWorkspace.addEventListener("change", () => {
    currentWorkspaceId = dom.asanaWorkspace.value || null;
    if (currentWorkspaceId) {
      loadProjects().catch(console.error);
    }
  });

  // Botón "Cargar tareas"
  dom.loadTasksBtn.addEventListener("click", async () => {
    syncCryptoPassword(); // aseguramos contraseña antes de cargar
	showLoader("Cargando tareas...");
    try {
      await handleLoadTasks();
    } catch (err) {
      console.error(err);
      alert("Error al cargar tareas desde Asana.");
	} finally {
	   hideLoader();
	}

  });

  // Contraseña cifrado: sincronizar mientras escribes y al salir del campo
  dom.cryptoPassword.addEventListener("input", syncCryptoPassword);
  dom.cryptoPassword.addEventListener("blur", syncCryptoPassword);

  // FAB: nueva tarea (si no hay seleccionada) o editar seleccionada
  dom.fabMain.addEventListener("click", () => {
    if (!currentSelectedTaskId) {
      createNewTask().catch(console.error);
    } else {
      openDetailsModal(currentSelectedTaskId).catch(console.error);
    }
  });

  // Cerrar modal de detalles
  dom.closeDetailsBtn.addEventListener("click", () => {
    hideDetailsModal();
  });
  dom.detailsModal.addEventListener("click", (ev) => {
    if (ev.target === dom.detailsModal) {
      hideDetailsModal();
    }
  });

  // Enviar comentario
  dom.commentForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!currentDetailTaskId) return;
    const text = dom.commentInput.value.trim();
    if (!text) return;
    try {
      await postComment(currentDetailTaskId, text);
      dom.commentInput.value = "";
      await loadComments(currentDetailTaskId);
    } catch (err) {
      console.error(err);
      alert("No se pudo enviar el comentario.");
    }
  });

  
	// Subir adjunto
	dom.attachmentInput.addEventListener("change", async () => {
	  const file = dom.attachmentInput.files[0];
	  if (!file || !currentDetailTaskId) return;

	  // 1) Intentamos subir el archivo
	  try {
		await uploadAttachment(currentDetailTaskId, file);
	  } catch (err) {
		console.error("Error real al subir el archivo:", err);
		alert("No se pudo subir el archivo.");
		return; // si la subida falla, no intentamos recargar la lista
	  }

	  // 2) Si la subida fue bien, limpiamos el input
	  dom.attachmentInput.value = "";

	  // 3) Intentamos recargar la lista de adjuntos; si falla, ya NO mostramos el mensaje de subida
	  try {
		await loadAttachments(currentDetailTaskId);
	  } catch (err) {
		console.error("El archivo se ha subido, pero hubo un problema al actualizar la lista de adjuntos:", err);
		// opcional: podrías mostrar un mensaje suave tipo "Recarga la página para ver la lista actualizada"
	  }
	});


  updateFabAppearance();
}

/* =============================
   Carga Workspaces/Proyectos
============================= */

function getTokenOrThrow() {
  const token = dom.asanaToken.value.trim();
  if (!token) throw new Error("Token Asana vacío");
  return token;
}

async function loadWorkspaces() {
  const token = getTokenOrThrow();
  const res = await fetch(`${ASANA_API_BASE}/workspaces`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Error al cargar workspaces");
  const json = await res.json();
  const workspaces = json.data || [];

  dom.asanaWorkspace.innerHTML = "";
  workspaces.forEach((ws) => {
    const opt = document.createElement("option");
    opt.value = ws.gid;
    opt.textContent = ws.name;
    dom.asanaWorkspace.appendChild(opt);
  });

  if (workspaces.length) {
    currentWorkspaceId = workspaces[0].gid;
    dom.asanaWorkspace.value = currentWorkspaceId;
    await loadProjects();
  }
}

async function loadProjects() {
  const token = getTokenOrThrow();
  if (!currentWorkspaceId) return;

  const url = new URL(`${ASANA_API_BASE}/projects`);
  url.searchParams.set("workspace", currentWorkspaceId);
  url.searchParams.set("archived", "false");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Error al cargar proyectos");
  const json = await res.json();
  const projects = json.data || [];

  dom.asanaProject.innerHTML = "";
  projects.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.gid;
    opt.textContent = p.name;
    dom.asanaProject.appendChild(opt);
  });

  if (projects.length) {
    currentProjectId = projects[0].gid;
    currentProjectName = projects[0].name;
    dom.asanaProject.value = currentProjectId;
    dom.headerProjectLabel.textContent = currentProjectName;
  }
}

/* =============================
   Carga de tareas y subtareas
============================= */

async function handleLoadTasks() {
  const token = getTokenOrThrow();

  if (!dom.asanaWorkspace.options.length) {
    await loadWorkspaces();
  }

  currentWorkspaceId = dom.asanaWorkspace.value || currentWorkspaceId;
  currentProjectId = dom.asanaProject.value || currentProjectId;

  if (!currentProjectId) {
    alert("Selecciona un proyecto.");
    return;
  }

  const selectedOpt = dom.asanaProject.selectedOptions[0];
  if (selectedOpt) {
    currentProjectName = selectedOpt.textContent || "";
    dom.headerProjectLabel.textContent = currentProjectName;
  }

  const tasks = await fetchTasksForProject(currentProjectId, token);

  const flatItems = [];
  for (const t of tasks) {
    const parentItem = mapAsanaTaskToItem(t, 0, null);
    flatItems.push(parentItem);

    const subtasks = await fetchSubtasksRecursive(t.gid, token, 1, t.gid);
    flatItems.push(...subtasks);
  }

  // Descifrar nombres si procede
  await decryptTaskNames(flatItems);

  initStore(flatItems);
  currentSelectedTaskId = null;
  updateFabAppearance();
  renderTaskList();

  dom.asanaConfigPanel.classList.add("hidden");
}

async function fetchTasksForProject(projectId, token) {
  const url = new URL(`${ASANA_API_BASE}/tasks`);
  url.searchParams.set("project", projectId);
  url.searchParams.set(
    "opt_fields",
    [
      "name",
      "completed",
      "due_on",
      "assignee.name",
      "assignee.email",
      "tags.name",
      "tags.color"
    ].join(",")
  );
  url.searchParams.set("limit", "100");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Error al cargar tareas del proyecto");
  const json = await res.json();
  return json.data || [];
}

async function fetchSubtasksRecursive(taskId, token, depth, parentId) {
  const url = new URL(`${ASANA_API_BASE}/tasks/${taskId}/subtasks`);
  url.searchParams.set(
    "opt_fields",
    [
      "name",
      "completed",
      "due_on",
      "assignee.name",
      "assignee.email",
      "tags.name",
      "tags.color"
    ].join(",")
  );
  url.searchParams.set("limit", "100");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return [];

  const json = await res.json();
  const data = json.data || [];

  const result = [];
  for (const st of data) {
    const item = mapAsanaTaskToItem(st, depth, parentId);
    result.push(item);

    const subSubtasks = await fetchSubtasksRecursive(
      st.gid,
      token,
      depth + 1,
      st.gid
    );
    result.push(...subSubtasks);
  }
  return result;
}

function mapAsanaTaskToItem(asanaTask, depth, parentId) {
  const completed = !!asanaTask.completed;

  return {
    id: asanaTask.gid,
    project: currentProjectName || "",
    task: asanaTask.name || "",
    status: completed ? "Completada" : "Pendiente",
    completed,
    owner: asanaTask.assignee ? asanaTask.assignee.name || "" : "",
    ownerEmail: asanaTask.assignee ? asanaTask.assignee.email || "" : "",
    dueDate: asanaTask.due_on || "",
    estimatedHours: null,
    tags: asanaTask.tags || [],
    depth: depth || 0,
    parentId: parentId || null
  };
}

// Descifrar títulos de tareas
async function decryptTaskNames(items) {
  if (!cryptoManager.masterPassword) return;
  const promises = [];

  for (const item of items) {
    if (
      item.task &&
      typeof item.task === "string" &&
      cryptoManager.isEncrypted(item.task)
    ) {
      const p = cryptoManager
        .decrypt(item.task)
        .then((plain) => {
          if (plain && plain !== "[ENCRIPTADO]") {
            item.task = plain;
          }
        })
        .catch((err) => {
          console.error("Error descifrando nombre de tarea:", err);
        });
      promises.push(p);
    }
  }
  await Promise.all(promises);
}

/* =============================
   Render de lista móvil
============================= */

function renderTaskList() {
  const items = getVisibleItems();
  dom.taskList.innerHTML = "";

  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "task-item";
    row.dataset.taskId = item.id;

    const depthLevel = Math.max(0, Math.min(item.depth || 0, 4));
    row.classList.add(`depth-${depthLevel}`);
    if (item.id === currentSelectedTaskId) {
      row.classList.add("selected");
    }

    const checkbox = document.createElement("div");
    checkbox.className = "task-checkbox";
    const isCompleted =
      item.completed || item.status === "Completada" ? true : false;
    if (isCompleted) checkbox.classList.add("checked");

    const content = document.createElement("div");
    content.className = "task-content";

    const title = document.createElement("div");
    title.className = "task-title";
    title.textContent = item.task || "(Sin título)";
    if (isCompleted) title.classList.add("completed");

    const subtext = document.createElement("div");
    subtext.className = "task-subtext";
    const bits = [];
    if (item.dueDate) bits.push(`Vence: ${item.dueDate}`);
    if (item.owner) bits.push(item.owner);
    subtext.textContent = bits.join(" · ");

    content.appendChild(title);
    content.appendChild(subtext);

    checkbox.addEventListener("click", (ev) => {
      ev.stopPropagation();
      toggleCompleted(item, checkbox, title);
    });

    row.addEventListener("click", () => {
      
	  // Si ya está seleccionada, al volver a pulsar la deseleccionamos
	  if (currentSelectedTaskId === item.id) {
	    currentSelectedTaskId = null;
	    highlightSelectedRow();
	    updateFabAppearance();
	    return; // No abrimos el modal en este caso
	  }
	
	  // Si era otra tarea, la seleccionamos y abrimos modal
	  currentSelectedTaskId = item.id;
	  updateFabAppearance();
	  highlightSelectedRow();
	  openDetailsModal(item.id).catch(console.error);

    });

    row.appendChild(checkbox);
    row.appendChild(content);
    dom.taskList.appendChild(row);
  });
}

function highlightSelectedRow() {
  const rows = dom.taskList.querySelectorAll(".task-item");
  rows.forEach((r) => r.classList.remove("selected"));
  if (!currentSelectedTaskId) return;
  const selected = dom.taskList.querySelector(
    `.task-item[data-task-id="${currentSelectedTaskId}"]`
  );
  if (selected) selected.classList.add("selected");
}

/* =============================
   Toggle completado (PUT Asana)
============================= */

async function toggleCompleted(item, checkboxEl, titleEl) {
  const newCompleted = !(item.completed || item.status === "Completada");

  item.completed = newCompleted;
  item.status = newCompleted ? "Completada" : "Pendiente";

  checkboxEl.classList.toggle("checked", newCompleted);
  titleEl.classList.toggle("completed", newCompleted);

  updateItemField(item.id, "status", item.status);
  updateItemField(item.id, "completed", newCompleted);

  try {
    await updateTaskCompletedInAsana(item.id, newCompleted);
  } catch (err) {
    console.error(err);
    alert("No se pudo guardar el cambio en Asana. Se revertirá el estado.");
    const revert = !newCompleted;
    item.completed = revert;
    item.status = revert ? "Completada" : "Pendiente";
    checkboxEl.classList.toggle("checked", revert);
    titleEl.classList.toggle("completed", revert);

    updateItemField(item.id, "status", item.status);
    updateItemField(item.id, "completed", revert);
  }
}

async function updateTaskCompletedInAsana(taskId, completed) {
  const token = getTokenOrThrow();
  const res = await fetch(`${ASANA_API_BASE}/tasks/${taskId}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ data: { completed } })
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Error Asana: ${txt || res.status}`);
  }
}

/* =============================
   Modal de detalles
============================= */

function showDetailsModal() {
  dom.detailsModal.classList.remove("hidden");
}

function hideDetailsModal() {
  dom.detailsModal.classList.add("hidden");
  
  currentDetailTaskId = null;

  // Al cerrar el modal, deseleccionamos la tarea y devolvemos el FAB a modo "nueva tarea"
  currentSelectedTaskId = null;
  highlightSelectedRow();
  updateFabAppearance();

}

function getTaskById(id) {
  const { items } = getState();
  return items.find((t) => t.id === id) || null;
}

async function openDetailsModal(taskId) {
  const token = getTokenOrThrow();
  const item = getTaskById(taskId);
  if (!item) return;

  currentDetailTaskId = taskId;

  dom.detailTitle.textContent = item.task || "(Sin título)";
  renderTags(item.tags || []);

  dom.detailDescription.value = "Cargando descripción...";
  dom.commentsList.innerHTML = "<div>Cargando comentarios...</div>";
  dom.attachmentsList.innerHTML = "<div>Cargando adjuntos...</div>";

  showDetailsModal();

  try {
    const detail = await fetchTaskDetails(taskId, token);
    let description = detail.notes || "";
    let title = detail.name || item.task || "";

    if (cryptoManager.masterPassword) {
      try {
        if (cryptoManager.isEncrypted(title)) {
          title = await cryptoManager.decrypt(title);
        }
        if (description && cryptoManager.isEncrypted(description)) {
          description = await cryptoManager.decrypt(description);
        }
      } catch {
        // si falla, dejamos los valores tal cual
      }
    }

    dom.detailTitle.textContent = title || "(Sin título)";
    dom.detailDescription.value = description || "";

    renderTags(detail.tags || []);
    await loadComments(taskId);
    await loadAttachments(taskId);
  } catch (err) {
    console.error(err);
    dom.detailDescription.textContent = "Error al cargar detalles.";
    dom.commentsList.innerHTML = "<div>Error al cargar comentarios.</div>";
    dom.attachmentsList.innerHTML = "<div>Error al cargar adjuntos.</div>";
  }
}

function renderTags(tags) {
  dom.detailTags.innerHTML = "";
  if (!tags.length) return;
  tags.forEach((t) => {
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.textContent = t.name || "";
    dom.detailTags.appendChild(chip);
  });
}


// Guardar descripción en Asana (con cifrado opcional)
async function saveDescription(taskId) {
  const token = getTokenOrThrow();
  const item = getTaskById(taskId);
  if (!item) return;

  // Texto tal y como está en el textarea (en claro)
  const plainDescription = dom.detailDescription.value || "";

  let notesForAsana = plainDescription;

  // Si hay contraseña, ciframos antes de enviar
  if (cryptoManager.masterPassword && plainDescription) {
    try {
      notesForAsana = await cryptoManager.encrypt(plainDescription);
    } catch (err) {
      console.error("Error cifrando descripción, se enviará en claro:", err);
      notesForAsana = plainDescription;
    }
  } else if (!plainDescription) {
    // Si el textarea está vacío, mandamos string vacío (borrar descripción)
    notesForAsana = "";
  }

  const res = await fetch(`${ASANA_API_BASE}/tasks/${taskId}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      data: {
        notes: notesForAsana
      }
    })
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || "Error al guardar descripción en Asana");
  }

  // Actualizamos el estado en memoria para que quede coherente
  updateItemField(taskId, "description", plainDescription);

  // Pequeño feedback visual (opcional: podrías mostrar un toast)
  console.log("Descripción guardada correctamente en Asana.");
}





async function fetchTaskDetails(taskId, token) {
  const url = new URL(`${ASANA_API_BASE}/tasks/${taskId}`);
  url.searchParams.set(
    "opt_fields",
    [
      "name",
      "notes",
      "completed",
      "assignee.name",
      "assignee.email",
      "tags.name",
      "tags.color"
    ].join(",")
  );
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Error al cargar detalles de la tarea");
  const json = await res.json();
  return json.data || {};
}

/* =============================
   Comentarios
============================= */

async function loadComments(taskId) {
  const token = getTokenOrThrow();
  const url = new URL(`${ASANA_API_BASE}/tasks/${taskId}/stories`);
  url.searchParams.set(
    "opt_fields",
    ["type", "resource_subtype", "text", "created_at", "created_by.name"].join(
      ","
    )
  );

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    dom.commentsList.innerHTML = "<div>Error al cargar comentarios.</div>";
    return;
  }

  const json = await res.json();
  const stories = (json.data || []).filter(
    (s) => s.resource_subtype === "comment_added"
  );

  dom.commentsList.innerHTML = "";
  if (!stories.length) {
    dom.commentsList.textContent = "No hay comentarios.";
    return;
  }

  for (const s of stories) {
    const item = document.createElement("div");
    item.className = "comment-item";

    const author = document.createElement("div");
    author.className = "comment-author";
    author.textContent = s.created_by ? s.created_by.name || "" : "";

    const text = document.createElement("div");
    text.className = "comment-text";

    let commentText = s.text || "";
    if (
      cryptoManager.masterPassword &&
      commentText &&
      cryptoManager.isEncrypted(commentText)
    ) {
      try {
        const dec = await cryptoManager.decrypt(commentText);
        if (dec && dec !== "[ENCRIPTADO]") commentText = dec;
      } catch (err) {
        console.error("Error descifrando comentario:", err);
      }
    }

    text.textContent = commentText;

    item.appendChild(author);
    item.appendChild(text);
    dom.commentsList.appendChild(item);
  }
}

async function postComment(taskId, text) {
  const token = getTokenOrThrow();
  let finalText = text;

  // Opcional: cifrar comentarios al enviar
  if (cryptoManager.masterPassword) {
    try {
      finalText = await cryptoManager.encrypt(text);
    } catch {
      finalText = text;
    }
  }

  const res = await fetch(`${ASANA_API_BASE}/tasks/${taskId}/stories`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ data: { text: finalText } })
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || "Error al crear comentario");
  }
}

/* =============================
   Adjuntos
============================= */

async function loadAttachments(taskId) {
  const token = getTokenOrThrow();
  const url = new URL(`${ASANA_API_BASE}/tasks/${taskId}/attachments`);
  url.searchParams.set(
    "opt_fields",
    ["name", "created_at", "download_url", "resource_type"].join(",")
  );

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    dom.attachmentsList.innerHTML = "<div>Error al cargar adjuntos.</div>";
    return;
  }

  const json = await res.json();
  const attachments = json.data || [];

  dom.attachmentsList.innerHTML = "";
  if (!attachments.length) {
    dom.attachmentsList.textContent = "No hay adjuntos.";
    return;
  }

  for (const a of attachments) {
    const row = document.createElement("div");
    row.className = "attachment-item";

    const name = document.createElement("div");
    let attName = a.name || "(sin nombre)";

    if (
      cryptoManager.masterPassword &&
      attName &&
      cryptoManager.isEncrypted(attName)
    ) {
      try {
        const decName = await cryptoManager.decrypt(attName);
        if (decName && decName !== "[ENCRIPTADO]") attName = decName;
      } catch (err) {
        console.error("Error descifrando nombre adjunto:", err);
      }
    }

    name.textContent = attName;

    const btn = document.createElement("button");
    btn.className = "btn-primary";
    btn.style.padding = "6px 10px";
    btn.style.fontSize = "0.8rem";
    btn.textContent = "Descargar";
    btn.addEventListener("click", () => {
      downloadAttachmentDecrypted(a).catch(console.error);
    });

    row.appendChild(name);
    row.appendChild(btn);
    dom.attachmentsList.appendChild(row);
  }
}

async function uploadAttachment(taskId, file) {
  showLoader("Subiendo archivo...");	
  const token = getTokenOrThrow();
  const formData = new FormData();

  if (cryptoManager.masterPassword) {
    // Subida cifrada
    const arrayBuffer = await file.arrayBuffer();
    const dataB64 = arrayBufferToBase64(arrayBuffer);

    const payload = {
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      dataB64
    };

    const payloadStr = JSON.stringify(payload);

    // Ciframos el contenido (payload completo)
    const encryptedPayload = await cryptoManager.encrypt(payloadStr);

    // Ciframos también el nombre para que en Asana aparezca "eyJz..."
    const encryptedName = await cryptoManager.encrypt(file.name);

    const encryptedBlob = new Blob([encryptedPayload], {
      type: "application/octet-stream"
    });

    formData.append("file", encryptedBlob, encryptedName);
  } else {
    // Sin contraseña → adjunto en claro
    formData.append("file", file);
  }

  
  
	try {
		const res = await fetch(`${ASANA_API_BASE}/tasks/${taskId}/attachments`, {
		method: "POST",
		headers: {
		  Authorization: `Bearer ${token}`
		},
		body: formData
	  });
	  } finally {
	   hideLoader();
	  }


  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || "Error al subir adjunto");
  }
}

// Descargar adjunto descifrado
async function downloadAttachmentDecrypted(att) {
  showLoader("Descargando...");	
  const token = getTokenOrThrow();
  /*
  const res = await fetch(att.download_url, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  */
  const res = await fetch(att.download_url);
  if (!res.ok) {
    const t = await res.text();
    console.error("Error al descargar adjunto:", t || res.status);
    window.open(att.download_url, "_blank");
    return;
  }

  const blob = await res.blob();

  try {
    // Nuestro formato cifrado guarda texto (base64 de JSON cifrado)
    const encryptedText = await blob.text();

    if (
      !cryptoManager.masterPassword ||
      !cryptoManager.isEncrypted(encryptedText)
    ) {
      // No es nuestro formato cifrado → lo abrimos tal cual
      const urlPlain = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = urlPlain;
      a.download = att.name || "archivo";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(urlPlain);
        a.remove();
      }, 1000);
      return;
    }

    const decryptedJson = await cryptoManager.decrypt(encryptedText);
    const payload = JSON.parse(decryptedJson);

    const { name, mimeType, dataB64 } = payload;
    const ab = base64ToArrayBuffer(dataB64);
    const fileBlob = new Blob([ab], {
      type: mimeType || "application/octet-stream"
    });

    const url = URL.createObjectURL(fileBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name || "archivo";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1000);
  } catch (err) {
    console.error("Error descifrando adjunto:", err);
    window.open(att.download_url, "_blank");
  } finally {
   hideLoader();
  }

  
}

/* =============================
   Nueva tarea rápida (FAB)
============================= */

async function createNewTask() {
  const token = getTokenOrThrow();
  if (!currentProjectId) {
    alert("No hay proyecto seleccionado.");
    return;
  }

  const name = prompt("Título de la nueva tarea:");
  if (!name) return;

  let finalName = name;
  if (cryptoManager.masterPassword) {
    try {
      finalName = await cryptoManager.encrypt(name);
    } catch {
      finalName = name;
    }
  }

  const res = await fetch(`${ASANA_API_BASE}/tasks`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      data: {
        name: finalName,
        projects: [currentProjectId]
      }
    })
  });

  if (!res.ok) {
    const t = await res.text();
    alert("Error al crear tarea: " + (t || res.status));
    return;
  }

  await handleLoadTasks();
}

/* =============================
   FAB apariencia
============================= */

function updateFabAppearance() {
  if (!dom.fabMain) return;
  if (!currentSelectedTaskId) {
    dom.fabMain.textContent = "＋";
    dom.fabMain.setAttribute("aria-label", "Nueva tarea");
  } else {
    dom.fabMain.textContent = "✎";
    dom.fabMain.setAttribute("aria-label", "Editar tarea seleccionada");
  }
}