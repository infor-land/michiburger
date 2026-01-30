
// app.js
// UI, renderizado de tabla, eventos y accesibilidad
// Ahora los datos se cargan directamente desde la API de Asana.

import {
  initStore,
  getState,
  getVisibleItems,
  getCounts,
  setGlobalFilter,
  setColumnFilter,
  setSort,
  updateItemField,
  revertAllChanges,
  saveChanges,
  STATUS_VALUES,
  PRIORITY_VALUES,
  getDirtyItems,
  markAsSaved
} from "./store.js";

import { cryptoManager } from "./crypto-utils.js"


// Definición de columnas de la tabla
const columns = [
  { key: "project", label: "Proyecto", type: "text", editable: false },
  { key: "task", label: "Tarea", type: "text", editable: true },
  {
    key: "status",
    label: "Estado",
    type: "select",
    editable: true,
    options: STATUS_VALUES
  },
  {
    key: "priority",
    label: "Prioridad",
    type: "select",
    editable: true,
    options: PRIORITY_VALUES
  },
  { key: "owner", label: "Responsable", type: "text", editable: false },
  { key: "ownerEmail", label: "Email", type: "email", editable: true },
  { key: "dueDate", label: "Fecha límite", type: "date", editable: false },
  {
    key: "estimatedHours",
    label: "Horas estimadas",
    type: "number",
    editable: true
  }
];

const selectors = {
  tableWrapper: document.getElementById("tableWrapper"),
  globalFilter: document.getElementById("globalFilter"),
  statsBar: document.getElementById("statsBar"),
  liveRegion: document.getElementById("liveRegion"),
  saveBtn: document.getElementById("saveBtn"),
  revertBtn: document.getElementById("revertBtn"),
  themeToggleBtn: document.getElementById("themeToggleBtn"),
  asanaToken: document.getElementById("asanaToken"),
  asanaWorkspace: document.getElementById("asanaWorkspace"),
  asanaProject: document.getElementById("asanaProject"),
  loadMetaBtn: document.getElementById("loadMetaBtn"),
  loadTasksBtn: document.getElementById("loadTasksBtn"),
  cryptoPassword: document.getElementById("cryptoPassword"),
 newProjectBtn: document.getElementById("newProjectBtn"),
 newTaskBtn: document.getElementById("newTaskBtn"),
 newProjectModal: document.getElementById("newProjectModal"),
 newProjectName: document.getElementById("newProjectName"),
 newProjectStatus: document.getElementById("newProjectStatus"),
 newProjectTeam: document.getElementById("newProjectTeam"),
 createProjectBtn: document.getElementById("createProjectBtn"),
 createTaskBtn: document.getElementById("createTaskBtn"),
 newTaskModal: document.getElementById("newTaskModal"),
 newTaskProject: document.getElementById("newTaskProject"),
 newTaskName: document.getElementById("newTaskName"),
 newTaskDueDate: document.getElementById("newTaskDueDate"),
 newTaskStatus: document.getElementById("newTaskStatus"),
 newSubtaskModal: document.getElementById("newSubtaskModal"),
 parentTaskLabel: document.getElementById("parentTaskLabel"),
 newSubtaskName: document.getElementById("newSubtaskName"),
 newSubtaskDueDate: document.getElementById("newSubtaskDueDate"),
 newSubtaskStatus: document.getElementById("newSubtaskStatus"),
 createSubtaskBtn: document.getElementById("createSubtaskBtn"),
 configColumnsBtn: document.getElementById("configColumnsBtn"),
 saveColumnConfigBtn: document.getElementById("saveColumnConfigBtn"),
 columnConfigModal: document.getElementById("columnConfigModal"), 
 editDescriptionModal: document.getElementById("editDescriptionModal"),
 editDescriptionTaskTitle: document.getElementById("editDescriptionTaskTitle"),
 editDescriptionTextarea: document.getElementById("editDescriptionTextarea"),
 editDescriptionStatus: document.getElementById("editDescriptionStatus"),
 saveDescriptionBtn: document.getElementById("saveDescriptionBtn"),

};
/*Columnas persistencia*/
let columnVisibility = JSON.parse(localStorage.getItem("columnVisibility") || "{}");
let columnWidths = JSON.parse(localStorage.getItem("columnWidths") || "{}");

/*AutoGuardado*/
let autosaveTimer=null;


function resetAutoSaveTimer() {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    saveChangesToAsana();
  }, 30000); // 30 segundos
}

function showAutoSaveSpinner() {
  document.getElementById("autoSaveSpinner").classList.remove("hidden");
}

function hideAutoSaveSpinner() {
  document.getElementById("autoSaveSpinner").classList.add("hidden");
}


/*Ancho columnas persistente*/

function openColumnConfig() {
  const body = document.getElementById("columnConfigBody");
  body.innerHTML = "";

  columns.forEach(col => {
    const checked = columnVisibility[col.key] !== false;
    const label = document.createElement("label");
    label.style.display = "block";

    label.innerHTML = `
      <input type="checkbox" data-col="${col.key}" ${checked ? "checked" : ""}>
      ${col.label}
    `;
    body.appendChild(label);
  });

  openModal(selectors.columnConfigModal);
}

function saveColumnConfig() {
  const body = document.getElementById("columnConfigBody");
  const inputs = body.querySelectorAll("input[type=checkbox]");

  inputs.forEach(inp => {
    columnVisibility[inp.dataset.col] = inp.checked;
  });

  localStorage.setItem("columnVisibility", JSON.stringify(columnVisibility));

  // Re-render tabla aplicando visibilidad
  applyColumnVisibility();
  closeModal("columnConfigModal");
}


/*Ficheros*/

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}


// Control de celda en edición actual
let currentEditor = {
  cell: null,
  itemId: null,
  column: null,
  originalValue: null
};

async function init() {
  renderTableShell();
  attachGlobalEvents();
  selectors.statsBar.textContent =
    "Introduce tu token de Asana, elige workspace y proyecto, y pulsa «Cargar tareas».";
}

/* ================================
   Integración Asana
   ================================ */

const ASANA_BASE_URL = "https://app.asana.com/api/1.0";

// Lista de proyectos del workspace actual (se rellena en loadProjects)
let asanaProjects = [];
let currentParentTaskId = null;
let currentParentTaskName = ""
let asanaTeams = [];

/*DescripcionTarea*/
let currentDescriptionTaskId = null;

async function asanaPost(endpoint, token, body) {
  const res = await fetch(`${ASANA_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ data: body })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} - ${text}`);
  }
  return res.json();
}

async function encryptNameIfNeeded(name) {
  if (cryptoManager.masterPassword && name) {
    return await cryptoManager.encrypt(name);
  }
  return name;
}


async function encryptCommentText(text) {
  if (!cryptoManager.masterPassword || !text) return text;
  return await cryptoManager.encrypt(text);
}

async function decryptCommentText(text) {
  if (!cryptoManager.masterPassword || !text) return text;
  if (!cryptoManager.isEncrypted(text)) return text;
  return await cryptoManager.decrypt(text);
}

async function getCommentsFromAsana(taskId, token) {
  const res = await asanaGet(
    `/tasks/${encodeURIComponent(
      taskId
    )}/stories?opt_fields=text,created_by.name,created_at,resource_subtype`,
    token
  );
  // Solo comentarios (no cambios de estado, etc.)
  return (res.data || []).filter(
    (s) => s.resource_subtype === "comment_added" && s.text
  );
}

async function addCommentToAsana(taskId, text, token) {
  const encryptedText = await encryptCommentText(text);
  return asanaPost(`/tasks/${encodeURIComponent(taskId)}/stories`, token, {
    text: encryptedText
  });
}



async function asanaGet(endpoint, token) {
  const res = await fetch(`${ASANA_BASE_URL}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} - ${text}`);
  }
  return res.json();
}

/*Ficheros*/

async function getAttachmentsForTask(taskId, token) {
  const res = await asanaGet(
    `/tasks/${encodeURIComponent(
      taskId
    )}/attachments?opt_fields=name,created_at,download_url`,
    token
  );
  return res.data || [];
}

// Sube un fichero cifrado (contenido y nombre) a Asana
async function uploadEncryptedAttachment(taskId, file, token) {
  if (!cryptoManager.masterPassword) {
    throw new Error(
      "Debes definir una contraseña de cifrado para subir archivos cifrados."
    );
  }

  // Leer fichero como binario → base64
  const arrayBuffer = await file.arrayBuffer();
  const dataB64 = arrayBufferToBase64(arrayBuffer);

  // Construimos un payload JSON con nombre, tipo y datos
  const payload = JSON.stringify({
    name: file.name,
    mime: file.type || "application/octet-stream",
    data: dataB64
  });

  // Ciframos el contenido
  const encryptedContent = await cryptoManager.encrypt(payload);

  // Ciframos el nombre (para mostrarlo descifrado sólo en la app)
  const encryptedName = await cryptoManager.encrypt(file.name);

  const blob = new Blob([encryptedContent], { type: "text/plain" });

  const formData = new FormData();
  formData.append("file", blob, encryptedName);

  const res = await fetch(
    `${ASANA_BASE_URL}/tasks/${encodeURIComponent(taskId)}/attachments`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`
      },
      body: formData
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} - ${text}`);
  }
  return res.json();
}


async function downloadAttachmentDecrypted(att, token) {
  try {
    // 1. Descargar SIEMPRE como binario
	/*  
    const res = await fetch(att.download_url, {
      // IMPORTANTE: normalmente NO hace falta Authorization aquí,
      // download_url suele estar ya pre-firmada; si esta cabecera da problemas,
      // puedes quitar todo el objeto "headers".
      
	  headers: {
        Authorization: `Bearer ${token}`
		
      }
    });
    */
	const res = await fetch(att.download_url);  
	  

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    const buf = await res.arrayBuffer();

    // 2. Intentar interpretar como texto UTF-8
    let text = "";
    let isTextDecodable = true;
    try {
      text = new TextDecoder("utf-8").decode(buf);
    } catch {
      isTextDecodable = false;
    }

    // 3. ¿Parece un payload cifrado de nuestra app?
    const canTryDecrypt =
      cryptoManager.masterPassword &&
      isTextDecodable &&
      text &&
      cryptoManager.isEncrypted(text);

    if (canTryDecrypt) {
      let payload;
      try {
        // decrypt(text) → string JSON con { name, mime, data(base64) }
        const decrypted = await cryptoManager.decrypt(text);
        payload = JSON.parse(decrypted);
      } catch (e) {
        console.error(
          "[Adjuntos] No se pudo interpretar el contenido como JSON cifrado:",
          e
        );
        // Fallback: descargar tal cual
        const blobFallback = new Blob([buf], {
          type: "application/octet-stream"
        });
        triggerBlobDownload(blobFallback, att.name || "archivo");
        return;
      }

      // 4. Reconstruir archivo original
      try {
        const bytes = base64ToUint8Array(payload.data);
        const blob = new Blob([bytes], {
          type: payload.mime || "application/octet-stream"
        });
        const filename = payload.name || "archivo";
        triggerBlobDownload(blob, filename);
        return;
      } catch (e) {
        console.error("[Adjuntos] Error reconstruyendo el archivo:", e);
        const blobFallback = new Blob([buf], {
          type: "application/octet-stream"
        });
        triggerBlobDownload(blobFallback, att.name || "archivo");
        return;
      }
    } else {
      // 5. No es nuestro formato cifrado → descargar binario tal cual
      const blob = new Blob([buf], {
        type: "application/octet-stream"
      });
      triggerBlobDownload(blob, att.name || "archivo");
    }
  } catch (err) {
    console.error("Error al descargar adjunto:", err);
    announce("Error al descargar el archivo. Revisa la consola.");
  }
}

// Helper para lanzar descarga en el navegador
function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "archivo";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }, 0);
}



async function downloadAttachmentDecrypted_oldold(att, token) {
  try {
    const res = await fetch(att.download_url, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    // Siempre obtenemos los bytes en bruto
    const buf = await res.arrayBuffer();

    let text = "";
    let isTextDecodable = true;

    // Intentar decodificar como texto UTF-8
    try {
      text = new TextDecoder("utf-8").decode(buf);
    } catch {
      isTextDecodable = false;
    }

    // ¿Es un payload cifrado por nuestra app?
    const canTryDecrypt =
      cryptoManager.masterPassword &&
      isTextDecodable &&
      text &&
      cryptoManager.isEncrypted(text);

    if (canTryDecrypt) {
      // Nuestro formato: encrypt(JSON.stringify({ name, mime, data: base64 }))
      let payload;
      try {
        const decrypted = await cryptoManager.decrypt(text);
        payload = JSON.parse(decrypted);
      } catch (e) {
        console.error("No se pudo interpretar el contenido como JSON cifrado:", e);
        // Si falla, lo tratamos como archivo normal (no cifrado o corrupto)
        const blobFallback = new Blob([buf], {
          type: "application/octet-stream"
        });
        triggerBlobDownload(blobFallback, att.name || "archivo");
        return;
      }

      // Reconstruir archivo original a partir del JSON descifrado
      const bytes = base64ToUint8Array(payload.data);
      const blob = new Blob([bytes], {
        type: payload.mime || "application/octet-stream"
      });
      const filename = payload.name || "archivo";

      triggerBlobDownload(blob, filename);
    } else {
      // Adjuntos no cifrados por nuestra app → descarga directa
      const blob = new Blob([buf], {
        type: "application/octet-stream"
      });
      triggerBlobDownload(blob, att.name || "archivo");
    }
  } catch (err) {
    console.error("Error al descargar adjunto:", err);
    announce("Error al descargar el archivo. Revisa la consola.");
  }
}

// Pequeño helper para lanzar la descarga en el navegador
function triggerBlobDownload_oldold(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "archivo";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }, 0);
}





async function downloadAttachmentDecrypted_old(att, token) {
  try {
    const res = await fetch(att.download_url, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    // Intentamos tratarlo como texto cifrado (nuestro formato)
    const text = await res.text();

    if (cryptoManager.masterPassword && cryptoManager.isEncrypted(text)) {
      // Descifrar contenido
      const decrypted = await cryptoManager.decrypt(text);
      const obj = JSON.parse(decrypted);
      const bytes = base64ToUint8Array(obj.data);
      const blob = new Blob([bytes], {
        type: obj.mime || "application/octet-stream"
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = obj.name || "archivo";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }, 0);
    } else {
      // Adjuntos no cifrados por esta app → descarga directa
      const blob = new Blob([text], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = att.name || "archivo";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }, 0);
    }
  } catch (err) {
    console.error("Error al descargar adjunto:", err);
    announce("Error al descargar el archivo. Revisa la consola.");
  }
}


async function toggleAttachmentsForTask(item, wrapper, toggleBtn) {
  const token = (selectors.asanaToken.value || "").trim();
  if (!token) {
    announce("Introduce tu token de Asana para ver los adjuntos.");
    return;
  }

  const panel = wrapper.querySelector(".attachments-panel");
  if (!panel) return;

  if (!panel.classList.contains("hidden")) {
    // Ocultar
    panel.classList.add("hidden");
    panel.innerHTML = "";
    return;
  }

  panel.classList.remove("hidden");
  panel.innerHTML = '<div class="comments-loading">Cargando archivos…</div>';

  try {
    let attachments = await getAttachmentsForTask(item.id, token);

    // Guardar recuento en el item y actualizar texto del botón
    item.attachmentCount = attachments.length;
    if (toggleBtn) {
      toggleBtn.textContent = `📎 Archivos (${attachments.length})`;
    }

    // Desencriptar nombres si procede
    for (const att of attachments) {
      if (
        cryptoManager.masterPassword &&
        cryptoManager.isEncrypted(att.name)
      ) {
        att.displayName = await cryptoManager.decrypt(att.name);
      } else {
        att.displayName = att.name;
      }
    }

    renderAttachmentsPanel(panel, item, attachments);
  } catch (err) {
    console.error("Error al cargar archivos:", err);
    panel.innerHTML =
      '<div class="comments-error">Error al cargar archivos adjuntos.</div>';
  }
}

function renderAttachmentsPanel(panel, item, attachments) {
  const token = (selectors.asanaToken.value || "").trim();
  panel.innerHTML = "";

  const header = document.createElement("div");
  header.className = "attachments-header";
  header.textContent = `Archivos (${attachments.length})`;
  panel.appendChild(header);

  const list = document.createElement("div");
  attachments.forEach((att) => {
    const row = document.createElement("div");
    row.className = "attachment-item";

    const main = document.createElement("div");
    main.className = "attachment-main";

    const nameDiv = document.createElement("div");
    nameDiv.className = "attachment-name";
    nameDiv.textContent = att.displayName || att.name || "Archivo";

    const metaDiv = document.createElement("div");
    metaDiv.className = "attachment-meta";
    const d = att.created_at ? new Date(att.created_at) : null;
    metaDiv.textContent = d ? `Subido el ${d.toLocaleDateString()}` : "";

    main.appendChild(nameDiv);
    main.appendChild(metaDiv);

    const actions = document.createElement("div");
    actions.className = "attachment-actions";
    const btnDownload = document.createElement("button");
    btnDownload.type = "button";
    btnDownload.className = "btn btn-primary btn-small";
    btnDownload.textContent = "Descargar";
    btnDownload.addEventListener("click", () =>
      downloadAttachmentDecrypted(att, token)
    );
    actions.appendChild(btnDownload);

    row.appendChild(main);
    row.appendChild(actions);
    list.appendChild(row);
  });

  panel.appendChild(list);

  // Zona de subida (botón + drag&drop)
  const uploadDiv = document.createElement("div");
  uploadDiv.className = "attachments-upload";

  const dropzone = document.createElement("div");
  dropzone.className = "attachment-dropzone";
  dropzone.textContent =
    "Arrastra archivos aquí o usa el botón para subir (cifrados)";

  const fileInput = document.createElement("input");
  fileInput.type = "file";

  const btnUpload = document.createElement("button");
  btnUpload.type = "button";
  btnUpload.className = "btn btn-primary btn-small";
  btnUpload.textContent = "Subir";

  // Subida por botón
  btnUpload.addEventListener("click", () => {
    if (!fileInput.files || !fileInput.files[0]) {
      announce("Selecciona un archivo primero.");
      return;
    }
    handleFileUpload(item, fileInput.files[0], panel);
  });

  // Subida al cambiar input
  fileInput.addEventListener("change", () => {
    if (fileInput.files && fileInput.files[0]) {
      handleFileUpload(item, fileInput.files[0], panel);
    }
  });

  // Drag & drop
  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });

  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("dragover");
  });

  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) {
      handleFileUpload(item, file, panel);
    }
  });

  uploadDiv.appendChild(dropzone);
  uploadDiv.appendChild(fileInput);
  uploadDiv.appendChild(btnUpload);

  panel.appendChild(uploadDiv);
}

async function handleFileUpload(item, file, panel) {
  const token = (selectors.asanaToken.value || "").trim();
  if (!token) {
    announce("Introduce tu token de Asana para subir archivos.");
    return;
  }
  try {
    announce("Subiendo archivo cifrado…");
    await uploadEncryptedAttachment(item.id, file, token);

    // Recargar adjuntos tras subir
    let attachments = await getAttachmentsForTask(item.id, token);
    item.attachmentCount = attachments.length;

    for (const att of attachments) {
      if (
        cryptoManager.masterPassword &&
        cryptoManager.isEncrypted(att.name)
      ) {
        att.displayName = await cryptoManager.decrypt(att.name);
      } else {
        att.displayName = att.name;
      }
    }
    // Actualizar botón en la fila
    const wrapper = panel.parentElement;
    const toggleBtn = wrapper.querySelector(".task-attachments-toggle");
    if (toggleBtn) {
      toggleBtn.textContent = `📎 Archivos (${attachments.length})`;
    }
    renderAttachmentsPanel(panel, item, attachments);
    announce("Archivo subido correctamente.");
  } catch (err) {
    console.error("Error al subir archivo:", err);
    announce("Error al subir archivo. Revisa la consola.");
  }
}



/**
 * Carga lista de workspaces en el select correspondiente
 */

async function loadWorkspaces() {  
	const token = (selectors.asanaToken.value || "").trim();  
	if (!token) {    
		announce("Por favor, introduce tu token primero.");    
		return;  
	}  
	try {    
		selectors.statsBar.textContent = "Cargando workspaces...";    
		const result = await asanaGet("/workspaces", token);    
		const workspaces = result.data || [];    
		
		const sel = selectors.asanaWorkspace;    
		sel.innerHTML = '<option value="">Selecciona workspace…</option>';    
		
		workspaces.forEach((ws) => {      
			const opt = document.createElement("option");      
			opt.value = ws.gid;      
			opt.textContent = ws.name;      
			sel.appendChild(opt);    
		});    
		
		if (workspaces.length === 0) {      
			selectors.statsBar.textContent =        
				"No se encontraron workspaces para este token.";      
			return;    
		}    
		// ✅ Si solo hay un workspace, lo seleccionamos y cargamos sus proyectos    
		if (workspaces.length === 1) {      
			sel.value = workspaces[0].gid;      
			selectors.statsBar.textContent = `Workspace seleccionado automáticamente: ${workspaces[0].name}. Cargando proyectos…`;      
			await loadProjects(workspaces[0].gid);    
		} else {      
			selectors.statsBar.textContent = `Workspaces cargados (${workspaces.length}). Selecciona uno para ver sus proyectos.`;    
		}    
		
		announce("Workspaces cargados correctamente.");  
	} catch (err) {    
		console.error(err);    
		selectors.statsBar.textContent = `Error al cargar workspaces: ${err.message}`;    
		announce("Error al cargar workspaces de Asana.");  
	}
}



async function loadWorkspaces_old() {
  const token = (selectors.asanaToken.value || "").trim();
  if (!token) {
    announce("Introduce tu token de Asana para cargar los workspaces.");
    return;
  }

  selectors.statsBar.textContent = "Cargando workspaces desde Asana...";
  try {
    const json = await asanaGet("/workspaces", token);
    const workspaces = json.data || [];

    const sel = selectors.asanaWorkspace;
    sel.innerHTML = '<option value="">Selecciona workspace…</option>';
    workspaces.forEach((ws) => {
      const opt = document.createElement("option");
      opt.value = ws.gid;
      opt.textContent = ws.name;
      sel.appendChild(opt);
    });

    selectors.statsBar.textContent = `Workspaces cargados (${workspaces.length}). Selecciona uno para listar proyectos.`;
    announce("Workspaces de Asana cargados correctamente.");
  } catch (err) {
    console.error(err);
    selectors.statsBar.textContent = `Error al cargar workspaces: ${err.message}`;
    announce("Error al cargar workspaces de Asana.");
  }
}

async function loadTeamsForWorkspace(workspaceId, token) {
  // Igual que en tu proyecto original extendido
  const json = await asanaGet(
    `/organizations/${encodeURIComponent(workspaceId)}/teams`,
    token
  );
  return json.data || [];
}

/**
 * Carga proyectos de un workspace
 */
async function loadProjects(workspaceId) {
  const token = (selectors.asanaToken.value || "").trim();
  if (!token || !workspaceId) return;

  selectors.statsBar.textContent = "Cargando proyectos desde Asana...";
  try {
    const json = await asanaGet(
      `/projects?workspace=${encodeURIComponent(workspaceId)}&archived=false`,
      token
    );

	  const projects = json.data || [];

	  // Guardamos proyectos en memoria para usarlos al cargar tareas
	  asanaProjects = projects;

	  const sel = selectors.asanaProject;
	  // Primera opción especial: ALL
	  sel.innerHTML = '<option value="ALL">Todos los proyectos</option>';
	  projects.forEach((p) => {
		const opt = document.createElement("option");
		opt.value = p.gid;
		opt.textContent = p.name;
		sel.appendChild(opt);
	  });

	  // Por defecto, dejamos seleccionada la opción "ALL"
	  sel.value = "ALL";

	
	
	
	
    selectors.statsBar.textContent = `Proyectos cargados (${projects.length}). Selecciona uno y pulsa «Cargar tareas».`;
    announce("Proyectos de Asana cargados correctamente.");
  } catch (err) {
    console.error(err);
    selectors.statsBar.textContent = `Error al cargar proyectos: ${err.message}`;
    announce("Error al cargar proyectos de Asana.");
  }
}

/**
 * Carga tareas de un proyecto de Asana y las mapea al modelo de tabla
 */
 
async function decryptAllTaskNames(items) {
  const result = [];

  for (const item of items) {
    const clone = { ...item };
    let name = clone.task;
	let desc = clone.description;

    // 1) Desencriptar si procede
    if (cryptoManager.masterPassword && cryptoManager.isEncrypted(name)) {
      name = await cryptoManager.decrypt(name);
    }
	
   // Desencriptar descripción
   if (cryptoManager.masterPassword && desc && cryptoManager.isEncrypted(desc)) {
      desc = await cryptoManager.decrypt(desc);
    }


    // 2) Prefijos según profundidad real
    if (clone.depth > 0) {
      const arrows = ">> ".repeat(clone.depth);
      name = arrows + name;
    }

    clone.task = name;
	clone.description = desc;
    result.push(clone);
  }

  return result;
} 
 
/*Ficheros contar*/ 
async function loadAttachmentCountsInBackground() {
  const token = (selectors.asanaToken.value || "").trim();
  if (!token) return;

  const state = getState();
  const items = state.items;

  for (const item of items) {
    try {
      const attachments = await getAttachmentsForTask(item.id, token);
      item.attachmentCount = attachments.length;
    } catch (err) {
      console.warn("Error al cargar contador de adjuntos para", item.id, err);
    }
  }

  renderTableBody();
  updateStats();
}


 
async function loadCommentCountsInBackground() {
  const token = (selectors.asanaToken.value || "").trim();
  if (!token) return;

  const state = getState();
  const items = state.items;

  for (const item of items) {
    try {
      const comments = await getCommentsFromAsana(item.id, token);
      const count = comments.length;
      item.commentCount = count;
    } catch (err) {
      console.warn("Error cargando contador de comentarios para", item.id, err);
    }
  }

  // Después de actualizar counts, re-renderizamos botones
  renderTableBody();
  updateStats();
}
 
 
function openModal(modalEl) {
  if (!modalEl) return;
  modalEl.classList.add("show");
  modalEl.setAttribute("aria-hidden", "false");
}

function closeModal(modalId) {
  const modalEl = document.getElementById(modalId);
  if (!modalEl) return;
  modalEl.classList.remove("show");
  modalEl.setAttribute("aria-hidden", "true");
}

// --- Nuevo proyecto ---

async function openNewProjectModal() {
  const token = (selectors.asanaToken.value || "").trim();
  const workspaceId = selectors.asanaWorkspace.value;

  if (!token || !workspaceId) {
    announce("Introduce tu token y selecciona un workspace antes de crear un proyecto.");
    return;
  }

  selectors.newProjectName.value = "";
  selectors.newProjectStatus.textContent = "";

  // Cargar equipos del workspace
  selectors.newProjectTeam.innerHTML = '<option value="">Cargando equipos...</option>';
  try {
    asanaTeams = await loadTeamsForWorkspace(workspaceId, token);
    if (asanaTeams.length === 0) {
      selectors.newProjectTeam.innerHTML =
        '<option value="">No se encontraron equipos en este workspace</option>';
    } else {
      selectors.newProjectTeam.innerHTML =
        '<option value="">Selecciona equipo…</option>';
      asanaTeams.forEach((team) => {
        const opt = document.createElement("option");
        opt.value = team.gid;
        opt.textContent = team.name;
        selectors.newProjectTeam.appendChild(opt);
      });
    }
  } catch (err) {
    console.error(err);
    selectors.newProjectTeam.innerHTML =
      '<option value="">Error al cargar equipos</option>';
    selectors.newProjectStatus.textContent = `Error al cargar equipos: ${err.message}`;
  }

  openModal(selectors.newProjectModal);
}

function openNewProjectModal_old() {
  if (!selectors.asanaWorkspace.value) {
    announce("Selecciona un workspace antes de crear un proyecto.");
    return;
  }
  selectors.newProjectName.value = "";
  selectors.newProjectStatus.textContent = "";
  openModal(selectors.newProjectModal);
}


async function createProject() {
  const token = (selectors.asanaToken.value || "").trim();
  const workspaceId = selectors.asanaWorkspace.value;
  const name = selectors.newProjectName.value.trim();
  const teamId = selectors.newProjectTeam.value;

  if (!token || !workspaceId || !name || !teamId) {
    selectors.newProjectStatus.textContent =
      "Token, workspace, equipo y nombre son obligatorios.";
    return;
  }

  selectors.newProjectStatus.textContent = "Creando proyecto...";

  try {
    const body = {
      name,
      team: teamId
    };
    await asanaPost("/projects", token, body);
    selectors.newProjectStatus.textContent = "Proyecto creado correctamente.";
    await loadProjects(workspaceId); // refrescar lista de proyectos
    setTimeout(() => closeModal("newProjectModal"), 700);
  } catch (err) {
    console.error(err);
    selectors.newProjectStatus.textContent = `Error: ${err.message}`;
  }
}

async function createProject_old() {
  const token = (selectors.asanaToken.value || "").trim();
  const workspaceId = selectors.asanaWorkspace.value;
  const name = selectors.newProjectName.value.trim();

  if (!token || !workspaceId || !name) {
    selectors.newProjectStatus.textContent =
      "Token, workspace y nombre son obligatorios.";
    return;
  }

  selectors.newProjectStatus.textContent = "Creando proyecto...";

  try {
    const body = {
      name,
      workspace: workspaceId
    };
    await asanaPost("/projects", token, body);
    selectors.newProjectStatus.textContent = "Proyecto creado correctamente.";
    await loadProjects(workspaceId); // refrescar lista de proyectos
    setTimeout(() => closeModal("newProjectModal"), 700);
  } catch (err) {
    console.error(err);
    selectors.newProjectStatus.textContent = `Error: ${err.message}`;
  }
}

// --- Nueva tarea ---
function openNewTaskModal() {
  if (!asanaProjects.length) {
    announce(
      "Carga primero los proyectos del workspace antes de crear una tarea."
    );
    return;
  }

  // Rellenar selector de proyecto dentro del modal (solo una selección)
  selectors.newTaskProject.innerHTML = "";
  asanaProjects.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.gid;
    opt.textContent = p.name;
    selectors.newTaskProject.appendChild(opt);
  });

  selectors.newTaskName.value = "";
  selectors.newTaskDueDate.value = "";
  selectors.newTaskStatus.textContent = "";

  openModal(selectors.newTaskModal);
}

async function createTask() {
  const token = (selectors.asanaToken.value || "").trim();
  const projectId = selectors.newTaskProject.value;
  let name = selectors.newTaskName.value.trim();
  const dueDate = selectors.newTaskDueDate.value || null;

  if (!token || !projectId || !name) {
    selectors.newTaskStatus.textContent =
      "Token, proyecto y nombre son obligatorios.";
    return;
  }

  selectors.newTaskStatus.textContent = "Creando tarea...";

  try {
    const encryptedName = await encryptNameIfNeeded(name);

    const body = {
      name: encryptedName,
      projects: [projectId]
    };
    if (dueDate) body.due_on = dueDate;

    await asanaPost("/tasks", token, body);

    selectors.newTaskStatus.textContent = "Tarea creada correctamente.";
    // Volvemos a cargar las tareas para reflejar el cambio
    await loadTasksFromAsana();
    setTimeout(() => closeModal("newTaskModal"), 700);
  } catch (err) {
    console.error(err);
    selectors.newTaskStatus.textContent = `Error: ${err.message}`;
  }
}

// --- Nueva subtarea ---
function openNewSubtaskModal(parentItem) {
  currentParentTaskId = parentItem.id;
  currentParentTaskName = parentItem.task;

  selectors.parentTaskLabel.textContent = parentItem.task;
  selectors.newSubtaskName.value = "";
  selectors.newSubtaskDueDate.value = "";
  selectors.newSubtaskStatus.textContent = "";

  openModal(selectors.newSubtaskModal);
}

async function createSubtask() {
  const token = (selectors.asanaToken.value || "").trim();
  let name = selectors.newSubtaskName.value.trim();
  const dueDate = selectors.newSubtaskDueDate.value || null;
  const parentId = currentParentTaskId;

  if (!token || !parentId || !name) {
    selectors.newSubtaskStatus.textContent =
      "Token, tarea padre y nombre son obligatorios.";
    return;
  }

  selectors.newSubtaskStatus.textContent = "Creando subtarea...";

  try {
    const encryptedName = await encryptNameIfNeeded(name);

    const body = {
      name: encryptedName,
      parent: parentId
    };
    if (dueDate) body.due_on = dueDate;

    await asanaPost("/tasks", token, body);

    selectors.newSubtaskStatus.textContent = "Subtarea creada correctamente.";
    // Recargamos la tabla (volverá a desencriptar nombres)
    await loadTasksFromAsana();
    setTimeout(() => closeModal("newSubtaskModal"), 700);
  } catch (err) {
    console.error(err);
    selectors.newSubtaskStatus.textContent = `Error: ${err.message}`;
  }
} 
 
 
async function loadTasksFromAsana() {
  const token = (selectors.asanaToken.value || "").trim();
  const workspaceId = selectors.asanaWorkspace.value;

  if (!token) {
    announce("Introduce tu token de Asana.");
    return;
  }
  if (!workspaceId) {
    announce("Selecciona un workspace.");
    return;
  }
  if (!asanaProjects.length) {
    announce("Primero carga los proyectos del workspace.");
    return;
  }

  // Proyectos seleccionados en el multiselect
  const sel = selectors.asanaProject;
  const selectedValues = Array.from(sel.selectedOptions).map((o) => o.value);

  let projectIdsToLoad;
  if (
    selectedValues.length === 0 ||
    selectedValues.includes("ALL") ||
    selectedValues[0] === ""
  ) {
    projectIdsToLoad = asanaProjects.map((p) => p.gid);
  } else {
    projectIdsToLoad = selectedValues;
  }

  selectors.statsBar.textContent = `Cargando tareas de ${projectIdsToLoad.length} proyecto(s) en Asana...`;

  const allItems = [];
  const seenTaskIds = new Set(); // para evitar duplicados

  // Helper recursivo: añade una tarea (principal o subtarea) y todo su árbol de descendientes
  
async function addTaskWithSubtree(taskObj, projectName, depth = 0, parentTaskName = "") {
  if (seenTaskIds.has(taskObj.gid)) return;
  seenTaskIds.add(taskObj.gid);

  if (depth === 0) {
    // Tarea principal
    const mainItem = mapAsanaTaskToItem(taskObj, projectName);
    mainItem.depth = 0;
    mainItem.isSubtask = false;
    allItems.push(mainItem);
  } else {
    // Subtarea de cualquier nivel
    const subItem = mapAsanaSubtaskToItem(
      taskObj,
      projectName,
      parentTaskName,
      depth
    );
    allItems.push(subItem);
  }

  // Obtener subtareas de este nodo
  try {
    const subtasksRes = await asanaGet(
      `/tasks/${taskObj.gid}/subtasks?opt_fields=name,notes,completed,due_on,assignee.email,assignee.name,custom_fields`,
      token
    );
    const subtasks = subtasksRes.data || [];

    for (const sub of subtasks) {
      await addTaskWithSubtree(
        sub,
        projectName,
        depth + 1,          //  incrementa nivel
        taskObj.name        //  padre REAL (cifrado)
      );
    }
  } catch (err) {
    console.warn("No se pudieron cargar subtareas de", taskObj.gid, err);
  }
}  
  
  
  
  async function addTaskWithSubtree_oldold(taskObj, projectName, isSubtask = false, parentTaskName = "") {
    if (seenTaskIds.has(taskObj.gid)) return;
    seenTaskIds.add(taskObj.gid);

    if (isSubtask) {
      const subItem = mapAsanaSubtaskToItem(taskObj, projectName, parentTaskName);
      allItems.push(subItem);
    } else {
      const mainItem = mapAsanaTaskToItem(taskObj, projectName);
      allItems.push(mainItem);
    }

    // Cargar sus subtareas (si las tiene) y repetir recursivamente
    try {
      const subtasksRes = await asanaGet(
        `/tasks/${encodeURIComponent(
          taskObj.gid
        )}/subtasks?opt_fields=name,notes,completed,due_on,assignee.name,assignee.email,projects.name,custom_fields`,
        token
      );
      const subtasks = subtasksRes.data || [];

      for (const sub of subtasks) {
        await addTaskWithSubtree(sub, projectName, true, taskObj.name);
      }
    } catch (subErr) {
      console.warn("No se pudieron cargar subtareas de", taskObj.gid, subErr);
    }
  }

  try {
    for (const projectId of projectIdsToLoad) {
      const projectName =
        asanaProjects.find((p) => p.gid === projectId)?.name || "Proyecto";

      // Tareas principales del proyecto
      const tasksRes = await asanaGet(
        `/tasks?project=${encodeURIComponent(
          projectId
        )}&opt_fields=name,notes,completed,due_on,assignee.name,assignee.email,projects.name`,
        token
      );
      const tasks = tasksRes.data || [];

      for (const t of tasks) {
        // Detalle (para custom_fields)
        let taskDetail;
        try {
          const taskDetailRes = await asanaGet(
            `/tasks/${encodeURIComponent(
              t.gid
            )}?opt_fields=name,notes,completed,due_on,assignee.name,assignee.email,projects.name,custom_fields`,
            token
          );
          taskDetail = taskDetailRes.data;
        } catch (detailErr) {
          console.warn("No se pudo cargar detalle de tarea", t.gid, detailErr);
          taskDetail = t;
        }

        // Añadimos tarea principal + TODO su árbol de subtareas (todos los niveles)
        await addTaskWithSubtree(taskDetail, projectName, false, "");
      }
    }

    // Desencriptar nombres (si hay contraseña) y marcar subtareas con ">>"
    const decrypted = await decryptAllTaskNames(allItems);
    initStore(decrypted);
    renderTableBody();
	applyColumnVisibility();
    updateStats();


	// Cargar número de comentarios por tarea en segundo plano
	loadCommentCountsInBackground();
	/*ContarFicheros*/
	loadAttachmentCountsInBackground();


    selectors.statsBar.textContent = `Tareas cargadas desde Asana: ${decrypted.length} (en ${projectIdsToLoad.length} proyecto(s)).`;
    announce(
      "Tareas y subtareas de Asana cargadas correctamente (incluidos niveles anidados)."
    );
  } catch (err) {
    console.error(err);
    selectors.statsBar.textContent = `Error al cargar tareas: ${err.message}`;
    announce("Error al cargar tareas de Asana.");
  }
} 
 
 
async function loadTasksFromAsana_completa() {
  const token = (selectors.asanaToken.value || "").trim();
  const workspaceId = selectors.asanaWorkspace.value;

  if (!token) {
    announce("Introduce tu token de Asana.");
    return;
  }
  if (!workspaceId) {
    announce("Selecciona un workspace.");
    return;
  }
  if (!asanaProjects.length) {
    announce("Primero carga los proyectos del workspace.");
    return;
  }

  // Obtener proyectos seleccionados en el multiselect
  const sel = selectors.asanaProject;
  const selectedValues = Array.from(sel.selectedOptions).map((o) => o.value);

  let projectIdsToLoad;
  if (
    selectedValues.length === 0 ||
    selectedValues.includes("ALL") ||
    selectedValues[0] === ""
  ) {
    // Nada seleccionado o "ALL" seleccionado → todos los proyectos del workspace
    projectIdsToLoad = asanaProjects.map((p) => p.gid);
  } else {
    projectIdsToLoad = selectedValues;
  }

  selectors.statsBar.textContent = `Cargando tareas de ${projectIdsToLoad.length} proyecto(s) en Asana...`;

  const allItems = [];

  try {
    for (const projectId of projectIdsToLoad) {
      const projectName =
        asanaProjects.find((p) => p.gid === projectId)?.name || "Proyecto";

      // 1) TAREAS PRINCIPALES DEL PROYECTO
      const tasksRes = await asanaGet(
        `/tasks?project=${encodeURIComponent(
          projectId
        )}&opt_fields=name,notes,completed,due_on,assignee.name,assignee.email,projects.name`,
        token
      );
      const tasks = tasksRes.data || [];

      for (const t of tasks) {
        // Detalle de la tarea (para custom_fields, etc.)
        let taskDetail;
        try {
          const taskDetailRes = await asanaGet(
            `/tasks/${encodeURIComponent(
              t.gid
            )}?opt_fields=name,notes,completed,due_on,assignee.name,assignee.email,projects.name,custom_fields`,
            token
          );
          taskDetail = taskDetailRes.data;
        } catch (detailErr) {
          console.warn("No se pudo cargar detalle de tarea", t.gid, detailErr);
          taskDetail = t;
        }

        const mainItem = mapAsanaTaskToItem(taskDetail, projectName);
        allItems.push(mainItem);

        // 2) SUBTAREAS DE ESTA TAREA
        try {
          const subtasksRes = await asanaGet(
            `/tasks/${encodeURIComponent(
              t.gid
            )}/subtasks?opt_fields=name,notes,completed,due_on,assignee.name,assignee.email,projects.name,custom_fields`,
            token
          );
          const subtasks = subtasksRes.data || [];
          for (const sub of subtasks) {
            const subItem = mapAsanaSubtaskToItem(
              sub,
              projectName,
              mainItem.task
            );
            allItems.push(subItem);
          }
        } catch (subErr) {
          console.warn("No se pudieron cargar subtareas de", t.gid, subErr);
        }
      }
    }

    // Desencriptar nombres (si hay contraseña)
    const decrypted = await decryptAllTaskNames(allItems);
    initStore(decrypted);
    renderTableBody();
	applyColumnVisibility();
    updateStats();

    selectors.statsBar.textContent = `Tareas cargadas desde Asana: ${decrypted.length} (en ${projectIdsToLoad.length} proyecto(s)).`;
    announce("Tareas y subtareas de Asana cargadas correctamente para los proyectos seleccionados.");
  } catch (err) {
    console.error(err);
    selectors.statsBar.textContent = `Error al cargar tareas: ${err.message}`;
    announce("Error al cargar tareas de Asana.");
  }
} 
 
/**
 * Mapea una tarea de Asana al formato interno de la tabla
 */
function mapAsanaTaskToItem(task, fallbackProjectName) {
  // id = gid de Asana (string)
  const id = task.gid;

  const projectName =
    (task.projects && task.projects[0] && task.projects[0].name) ||
    fallbackProjectName ||
    "";

  const ownerName = task.assignee?.name || "";
  const ownerEmail = task.assignee?.email || "";

  const dueDate = task.due_on || "";

  // Status: usamos 'completed' como base
  let status = "Pendiente";
  if (task.completed === true) {
    status = "Completada";
  }

  // Priority y EstimatedHours: intentamos detectar custom_fields por nombre
  let priority = "Media";
  let estimatedHours = null;

  if (Array.isArray(task.custom_fields)) {
    for (const cf of task.custom_fields) {
      const cfName = (cf.name || "").toLowerCase();
      if (cfName.includes("priority") || cfName.includes("prioridad")) {
        // Campo tipo enum (lo más normal)
        if (cf.type === "enum" && cf.enum_value) {
          priority = cf.enum_value.name || priority;
        }
      }
      if (
        cfName.includes("estimated") ||
        cfName.includes("horas") ||
        cfName.includes("hours")
      ) {
        if (cf.type === "number" && typeof cf.number_value === "number") {
          estimatedHours = cf.number_value;
        }
      }
    }
  }

  return {
    id,
    project: projectName,
    task: task.name || "",
	description: task.notes || "",
    status,
    priority,
    owner: ownerName,
    ownerEmail,
    dueDate,
    estimatedHours
  };
}



/**
 * Mapea una subtarea de Asana al formato interno.
 * Se marca visualmente como subtarea con un prefijo en el nombre.
 */
 
function mapAsanaSubtaskToItem(subtask, fallbackProjectName, parentTaskName, depth) {
  const base = mapAsanaTaskToItem(subtask, fallbackProjectName);

  return {
    ...base,
    isSubtask: true,
    depth: depth,                      //  Nivel de profundidad real (1,2,3...)
    parentTask: parentTaskName,        //  Nombre del padre REAL
    project: base.project || fallbackProjectName
  };
} 
 
function mapAsanaSubtaskToItem_oldold(subtask, fallbackProjectName, parentTaskName) {
  const base = mapAsanaTaskToItem(subtask, fallbackProjectName);

  return {
    ...base,
    // Prefijo para que se vea que es subtarea
    //task: `>> ${base.task}`,
	isSubtask : true,
    // Opcional: incluir el nombre de la tarea padre al final
    project: base.project || fallbackProjectName,
    parentTask: parentTaskName
  };
}


/* ================================
   Renderizado de tabla
   ================================ */

function renderTableShell() {
  const wrapper = selectors.tableWrapper;
  wrapper.innerHTML = "";

  const inner = document.createElement("div");
  inner.className = "table-wrapper-inner";

  const table = document.createElement("table");
  table.className = "data-table";
  table.setAttribute("role", "grid");

  const thead = document.createElement("thead");

  // =========================
  // Fila 1: CABECERAS
  // =========================
  const headerRow = document.createElement("tr");

  columns.forEach((col) => {
    const th = document.createElement("th");
    th.scope = "col";
    th.tabIndex = 0;
    th.dataset.colKey = col.key;
    th.classList.add("th-sortable");
    th.setAttribute("aria-sort", "none");
	
	/*Gestionar Ancho Columnas*/
	// Aplicar visibilidad guardada
	if (columnVisibility[col.key] === false) {
	  th.style.display = "none";
	}

	// Aplicar ancho guardado
	if (columnWidths[col.key]) {
	  th.style.width = columnWidths[col.key];
	}

	// Resizer
	const resizer = document.createElement("div");
	resizer.className = "th-resizer";
	resizer.addEventListener("mousedown", startResize);
	th.appendChild(resizer);

    const labelSpan = document.createElement("span");
    labelSpan.textContent = col.label;
    labelSpan.className = "th-sort-label";

    const indicator = document.createElement("span");
    indicator.className = "th-sort-indicator";
    indicator.textContent = "⇅";

    th.append(labelSpan, indicator);
    headerRow.appendChild(th);
  });

  // =========================
  // Fila 2: FILTROS
  // =========================
  const filtersRow = document.createElement("tr");
  filtersRow.className = "table-filters-row";

  columns.forEach((col) => {
    const filterTh = document.createElement("th");

    // ---- DueDate rango ----
    if (col.key === "dueDate") {
      const rangeDiv = document.createElement("div");
      rangeDiv.className = "table-filter-range";

      const from = document.createElement("input");
      from.type = "date";
      from.className = "table-filter-input";
      from.dataset.filterKey = "dueDateFrom";

      const to = document.createElement("input");
      to.type = "date";
      to.className = "table-filter-input";
      to.dataset.filterKey = "dueDateTo";

      rangeDiv.append(from, to);
      filterTh.appendChild(rangeDiv);
    }
    // ---- Horas rango ----
    else if (col.key === "estimatedHours") {
      const rangeDiv = document.createElement("div");
      rangeDiv.className = "table-filter-range";

      const min = document.createElement("input");
      min.type = "number";
      min.className = "table-filter-input";
      min.placeholder = "≥ horas";
      min.dataset.filterKey = "hoursMin";

      const max = document.createElement("input");
      max.type = "number";
      max.className = "table-filter-input";
      max.placeholder = "≤ horas";
      max.dataset.filterKey = "hoursMax";

      rangeDiv.append(min, max);
      filterTh.appendChild(rangeDiv);
    }
    // ---- Select ----
    else if (col.type === "select") {
      const select = document.createElement("select");
      select.className = "table-filter-input";
      select.dataset.filterKey = col.key;

      const optAll = document.createElement("option");
      optAll.value = "";
      optAll.textContent = "Todos";
      select.appendChild(optAll);

      col.options.forEach((opt) => {
        const o = document.createElement("option");
        o.value = opt;
        o.textContent = opt;
        select.appendChild(o);
      });

      filterTh.appendChild(select);
    }
    // ---- Texto ----
    else {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "table-filter-input";
      input.placeholder = "Filtrar...";
      input.dataset.filterKey = col.key;
      filterTh.appendChild(input);
    }

    filtersRow.appendChild(filterTh);
  });


  // Columna extra para acciones (nueva subtarea)
  const thActions = document.createElement("th");
  thActions.textContent = "Acciones";
  thActions.classList.add("actions-col");
  headerRow.appendChild(thActions);

  const thActionsFilter = document.createElement("th");
  thActionsFilter.classList.add("actions-col");
  filtersRow.appendChild(thActionsFilter);





  thead.append(headerRow, filtersRow);

  const tbody = document.createElement("tbody");
  tbody.id = "dataTableBody";

  table.append(thead, tbody);
  inner.appendChild(table);
  wrapper.appendChild(inner);

  headerRow.addEventListener("click", onHeaderClick);
  headerRow.addEventListener("keydown", onHeaderKeyDown);
  filtersRow.addEventListener("input", onColumnFilterInput);
}


/*Redimensionamiento de campos*/

let currentResize = null;

function startResize(e) {
  currentResize = {
    th: e.target.parentElement,
    startX: e.pageX,
    startWidth: e.target.parentElement.offsetWidth,
    colKey: e.target.parentElement.dataset.colKey
  };
  document.addEventListener("mousemove", onResize);
  document.addEventListener("mouseup", endResize);
}

function onResize(e) {
  if (!currentResize) return;

  const delta = e.pageX - currentResize.startX;
  const newWidth = currentResize.startWidth + delta;
  currentResize.th.style.width = newWidth + "px";
}

function endResize() {
  if (!currentResize) return;

  // Guardar ancho en localStorage
  columnWidths[currentResize.colKey] = currentResize.th.style.width;
  localStorage.setItem("columnWidths", JSON.stringify(columnWidths));

  document.removeEventListener("mousemove", onResize);
  document.removeEventListener("mouseup", endResize);
  currentResize = null;
}

function openEditDescriptionModal(item) {
  currentDescriptionTaskId = item.id;
  selectors.editDescriptionTaskTitle.textContent = item.task;
  selectors.editDescriptionTextarea.value = item.description || "";
  selectors.editDescriptionStatus.textContent = "";
  openModal(selectors.editDescriptionModal);
}

async function saveDescriptionFromModal() {
  if (!currentDescriptionTaskId) return;
  const newDesc = selectors.editDescriptionTextarea.value;

  // Actualizar en store
  updateItemField(currentDescriptionTaskId, "description", newDesc);

  // Re-render y marcar dirty
  renderTableBody();
  applyColumnVisibility && applyColumnVisibility();
  updateStats && updateStats();
  selectors.editDescriptionStatus.textContent = "Descripción actualizada en memoria.";
  resetAutoSaveTimer && resetAutoSaveTimer();

  // Cerrar modal al poco tiempo
  setTimeout(() => {
    closeModal("editDescriptionModal");
    selectors.editDescriptionStatus.textContent = "";
  }, 800);
}

/**
 * Renderiza el cuerpo de la tabla (tbody) con los datos visibles
 */
 
 
function renderTableBody() {
  const tbody = document.getElementById("dataTableBody");
  if (!tbody) return;

  tbody.innerHTML = "";
  const items = getVisibleItems();

  items.forEach((item) => {
    const tr = document.createElement("tr");
    tr.dataset.itemId = String(item.id);

    columns.forEach((col) => {
      const td = document.createElement("td");
      td.dataset.colKey = col.key;

      if (col.editable) {
        td.classList.add("cell-editable");
        td.tabIndex = 0;
      }

      let contentNode;

      if (col.key === "status") {
        const span = document.createElement("span");
        span.textContent = item.status || "";
        const cls = getStatusBadgeClass(item.status);
        span.className = `badge ${cls}`;
        contentNode = span;

      } else if (col.key === "priority") {
        const span = document.createElement("span");
        span.textContent = item.priority || "";
        const cls = getPriorityBadgeClass(item.priority);
        span.className = `badge ${cls}`;
        contentNode = span;

      } else if (col.key === "estimatedHours") {
        contentNode = document.createTextNode(
          item.estimatedHours != null ? String(item.estimatedHours) : ""
        );

      } else if (col.key === "task") {
        const wrapper = document.createElement("div");

        // ==== TÍTULO ====
        const titleDiv = document.createElement("div");
        titleDiv.className = "task-title";
        titleDiv.textContent = item.task || "";

        // ==== DESCRIPCIÓN (colapsable) ====
        const descWrapper = document.createElement("div");
        descWrapper.className = "task-desc-wrapper";

        const descDiv = document.createElement("div");
        descDiv.className = "task-desc task-desc-collapsed";

        let hasDescription = !!item.description;
        if (hasDescription) {
          descDiv.textContent = item.description;
        } else {
          descDiv.textContent = "Añadir descripción…";
          descDiv.classList.add("task-desc--empty");
        }

        let needsToggle = false;
        if (hasDescription) {
          const lines = item.description.split(/\r?\n/);
          needsToggle = lines.length > 3;
        }

        const toggleBtn = document.createElement("span");
        toggleBtn.className = "desc-toggle-btn";

        if (!hasDescription || !needsToggle) {
          toggleBtn.style.display = "none";
        } else {
          toggleBtn.textContent = "Mostrar más";
        }

        descDiv.addEventListener("click", (e) => {
          if (e.target === toggleBtn) return;
          openEditDescriptionModal(item);
        });

        toggleBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const collapsed = descDiv.classList.contains("task-desc-collapsed");
          if (collapsed) {
            descDiv.classList.remove("task-desc-collapsed");
            toggleBtn.textContent = "Mostrar menos";
          } else {
            descDiv.classList.add("task-desc-collapsed");
            toggleBtn.textContent = "Mostrar más";
          }
        });

        descWrapper.appendChild(descDiv);
        descWrapper.appendChild(toggleBtn);

        wrapper.appendChild(titleDiv);
        wrapper.appendChild(descWrapper);
		
		
		

        // ==== COMENTARIOS ====
        const commentsToggle = document.createElement("button");
        commentsToggle.type = "button";
        commentsToggle.className = "task-comments-toggle";

        const count =
          typeof item.commentCount === "number" ? item.commentCount : null;
        commentsToggle.textContent =
          count !== null
            ? `💬 Comentarios (${count})`
            : "💬 Comentarios (?)";

        commentsToggle.addEventListener("click", () =>
          toggleCommentsForTask(item, wrapper, commentsToggle)
        );

        const commentsPanel = document.createElement("div");
        commentsPanel.className = "comments-panel hidden";
        commentsPanel.dataset.taskId = item.id;

        wrapper.appendChild(commentsToggle);
        wrapper.appendChild(commentsPanel);
		
		// ==== BOTÓN DE ADJUNTOS ====
		const attachmentsToggle = document.createElement("button");
		attachmentsToggle.type = "button";
		attachmentsToggle.className = "task-attachments-toggle";

		const filesCount =
		  typeof item.attachmentCount === "number" ? item.attachmentCount : null;
		attachmentsToggle.textContent =
		  filesCount !== null
			? `📎 Archivos (${filesCount})`
			: "📎 Archivos (?)";

		attachmentsToggle.addEventListener("click", () =>
		  toggleAttachmentsForTask(item, wrapper, attachmentsToggle)
		);

		const attachmentsPanel = document.createElement("div");
		attachmentsPanel.className = "attachments-panel hidden";
		attachmentsPanel.dataset.taskId = item.id;

		wrapper.appendChild(attachmentsToggle);
		wrapper.appendChild(attachmentsPanel);



		//Al wrapper ya le hemos ido metiendo Child y ahora lo asignamos al nodo
        contentNode = wrapper;

      } else {
        contentNode = document.createTextNode(item[col.key] ?? "");
      }

      td.appendChild(contentNode);
      tr.appendChild(td);
    });

    // Columna Acciones: botón "Nueva subtarea"
    const tdActions = document.createElement("td");
    tdActions.classList.add("actions-col");
    const btnSub = document.createElement("button");
    btnSub.type = "button";
    btnSub.className = "btn btn-secondary btn-small";
    btnSub.textContent = "➕";
    btnSub.title = "Crear subtarea";
    btnSub.addEventListener("click", () => {
      openNewSubtaskModal(item);
    });
    tdActions.appendChild(btnSub);
    tr.appendChild(tdActions);

    tbody.appendChild(tr);
  });

  markDirtyCells();
  updateHeaderSortIndicators();
}
 
 
 
function renderTableBody_old() {
  const tbody = document.getElementById("dataTableBody");
  if (!tbody) return;

  tbody.innerHTML = "";
  const items = getVisibleItems();

  items.forEach((item) => {
    const tr = document.createElement("tr");
    tr.dataset.itemId = String(item.id);

    columns.forEach((col) => {
      const td = document.createElement("td");
      td.dataset.colKey = col.key;

      if (col.editable) {
        td.classList.add("cell-editable");
        td.tabIndex = 0;
      }

      let contentNode;

      if (col.key === "status") {
        const span = document.createElement("span");
        span.textContent = item.status || "";
        const cls = getStatusBadgeClass(item.status);
        span.className = `badge ${cls}`;
        contentNode = span;
      } else if (col.key === "priority") {
        const span = document.createElement("span");
        span.textContent = item.priority || "";
        const cls = getPriorityBadgeClass(item.priority);
        span.className = `badge ${cls}`;
        contentNode = span;
      } else if (col.key === "estimatedHours") {
        contentNode = document.createTextNode(
          item.estimatedHours != null ? String(item.estimatedHours) : ""
        );

      } else if (col.key === "task") {
		  
		
        const wrapper = document.createElement("div");
/*
        const titleDiv = document.createElement("div");
        titleDiv.className = "task-title";
        titleDiv.textContent = item.task || "";

        const descDiv = document.createElement("div");
        descDiv.className = "task-desc";
        if (item.description) {
          descDiv.textContent = item.description;
        } else {
          descDiv.textContent = "Añadir descripción…";
          descDiv.classList.add("task-desc--empty");
        }
        descDiv.addEventListener("click", () => openEditDescriptionModal(item));
*/
/*
		// ----- DESCRIPCIÓN CON VISTA COMPACTA / EXPANDIDA -----
		const descWrapper = document.createElement("div");
		descWrapper.className = "task-desc-wrapper";

		const descDiv = document.createElement("div");
		descDiv.className = "task-desc task-desc-collapsed";

		let hasDescription = !!item.description;
		if (hasDescription) {
		  descDiv.textContent = item.description;
		} else {
		  descDiv.textContent = "Añadir descripción…";
		  descDiv.classList.add("task-desc--empty");
		}

		// Botón expandir/compactar
		const toggleBtn = document.createElement("span");
		toggleBtn.className = "desc-toggle-btn";

		// Decidir si realmente necesitamos el botón
		let needsToggle = false;
		if (hasDescription) {
		  const lines = item.description.split(/\r?\n/);
		  needsToggle = lines.length > 3; // solo si hay más de 3 líneas
		}

		if (!hasDescription || !needsToggle) {
		  // Sin descripción o solo pocas líneas → no mostramos el enlace
		  toggleBtn.style.display = "none";
		} else {
		  toggleBtn.textContent = "Mostrar más";
		}

		// Click en la descripción → abre modal (salvo si el click es en el toggle)
		descDiv.addEventListener("click", (e) => {
		  if (e.target === toggleBtn) return;
		  openEditDescriptionModal(item);
		});

		// Click en "Mostrar más / menos" → expandir/contraer SOLO la descripción
		toggleBtn.addEventListener("click", (e) => {
		  e.stopPropagation(); // que no dispare el modal
		  const collapsed = descDiv.classList.contains("task-desc-collapsed");
		  if (collapsed) {
			descDiv.classList.remove("task-desc-collapsed");
			toggleBtn.textContent = "Mostrar menos";
		  } else {
			descDiv.classList.add("task-desc-collapsed");
			toggleBtn.textContent = "Mostrar más";
		  }
		});

		// ORDEN CORRECTO: primero la descripción, luego el enlace
		descWrapper.appendChild(descDiv);
		descWrapper.appendChild(toggleBtn);

		// Añadimos el bloque de descripción al wrapper de la tarea
		wrapper.appendChild(descWrapper);
		


        // Botón para mostrar/ocultar comentarios
        const commentsToggle = document.createElement("button");
        commentsToggle.type = "button";
        commentsToggle.className = "task-comments-toggle";
        
		// usar el número si ya lo tenemos, si no, mostrar (?)
		const count = typeof item.commentCount === "number" ? item.commentCount : null;
		commentsToggle.textContent = count !== null
		  ? `💬 Comentarios (${count})`
		  : "💬 Comentarios (?)";

        commentsToggle.addEventListener("click", () =>
          toggleCommentsForTask(item, wrapper)
        );

        // Contenedor donde se pintarán los comentarios
        const commentsPanel = document.createElement("div");
        commentsPanel.className = "comments-panel hidden";
        commentsPanel.dataset.taskId = item.id;

        wrapper.appendChild(titleDiv);
        wrapper.appendChild(descDiv);
        wrapper.appendChild(commentsToggle);
        wrapper.appendChild(commentsPanel);
        contentNode = wrapper;

*/		

		// ==== TÍTULO ====
		const titleDiv = document.createElement("div");
		titleDiv.className = "task-title";
		titleDiv.textContent = item.task || "";

		// ==== DESCRIPCIÓN (colapsable) ====
		const descWrapper = document.createElement("div");
		descWrapper.className = "task-desc-wrapper";

		const descDiv = document.createElement("div");
		descDiv.className = "task-desc task-desc-collapsed";

		if (item.description) {
		  descDiv.textContent = item.description;
		} else {
		  descDiv.textContent = "Añadir descripción…";
		  descDiv.classList.add("task-desc--empty");
		}

		// ¿Cuántas líneas reales tiene la descripción?
		let hasDescription = !!item.description;
		let needsToggle = false;

		if (hasDescription) {
		  const lines = item.description.split(/\r?\n/);
		  needsToggle = lines.length > 3;
		}

		// ==== BOTÓN MOSTRAR MÁS / MENOS ====
		const toggleBtn = document.createElement("span");
		toggleBtn.className = "desc-toggle-btn";

		if (!hasDescription || !needsToggle) {
		  toggleBtn.style.display = "none";
		} else {
		  toggleBtn.textContent = "Mostrar más";
		}

		descDiv.addEventListener("click", (e) => {
		  if (e.target === toggleBtn) return;
		  openEditDescriptionModal(item);
		});

		toggleBtn.addEventListener("click", (e) => {
		  e.stopPropagation();
		  const collapsed = descDiv.classList.contains("task-desc-collapsed");
		  if (collapsed) {
			descDiv.classList.remove("task-desc-collapsed");
			toggleBtn.textContent = "Mostrar menos";
		  } else {
			descDiv.classList.add("task-desc-collapsed");
			toggleBtn.textContent = "Mostrar más";
		  }
		});

		// ORDEN CORRECTO:
		descWrapper.appendChild(descDiv);
		descWrapper.appendChild(toggleBtn);

		wrapper.appendChild(titleDiv);       // primero título
		wrapper.appendChild(descWrapper);    // luego descripción + botón
		
		
		
      } else {
        contentNode = document.createTextNode(item[col.key] ?? "");
      }


      td.appendChild(contentNode);
      tr.appendChild(td);
    });


    // Columna Acciones: botón "Nueva subtarea"
    const tdActions = document.createElement("td");
    tdActions.classList.add("actions-col");
    const btnSub = document.createElement("button");
    btnSub.type = "button";
    btnSub.className = "btn btn-secondary btn-small";
    btnSub.textContent = "➕";
    btnSub.title = "Crear subtarea";
    btnSub.addEventListener("click", () => {
      openNewSubtaskModal(item);
    });
    tdActions.appendChild(btnSub);
    tr.appendChild(tdActions);




    tbody.appendChild(tr);
  });

  // Marcar celdas "dirty"
  markDirtyCells();
  updateHeaderSortIndicators();
}


async function toggleCommentsForTask(item, wrapper, toggleBtn) {
  const token = (selectors.asanaToken.value || "").trim();
  if (!token) {
    announce("Introduce tu token de Asana para ver los comentarios.");
    return;
  }

  const panel = wrapper.querySelector('.comments-panel');
  if (!panel) return;

  // Si ya está visible, lo ocultamos
  if (!panel.classList.contains('hidden')) {
    panel.classList.add('hidden');
    panel.innerHTML = "";
    return;
  }

  panel.classList.remove('hidden');
  panel.innerHTML = '<div class="comments-loading">Cargando comentarios…</div>';

  try {
    let comments = await getCommentsFromAsana(item.id, token);
    // Desencriptar texto si es necesario
    for (const c of comments) {
      c.text = await decryptCommentText(c.text);
    }
    
	   // guardar el número en el propio item y actualizar botón
	   item.commentCount = comments.length;
	   if (toggleBtn) {
		 toggleBtn.textContent = `💬 Comentarios (${comments.length})`;
	   }
	   renderCommentsPanel(panel, item, comments);

  } catch (err) {
    console.error("Error al cargar comentarios:", err);
    panel.innerHTML =
      '<div class="comments-error">Error al cargar comentarios.</div>';
  }
}

function renderCommentsPanel(panel, item, comments) {
  panel.innerHTML = "";

  const header = document.createElement("div");
  header.className = "comments-header";
  header.textContent = `Comentarios (${comments.length})`;
  panel.appendChild(header);

  const list = document.createElement("div");
  list.className = "comments-list";

  comments.forEach((c) => {
    const div = document.createElement("div");
    div.className = "comment-item";

    const meta = document.createElement("div");
    meta.className = "comment-meta";
    const author = document.createElement("span");
    author.className = "comment-author";
    author.textContent = c.created_by?.name || "Usuario";
    const date = document.createElement("span");
    const d = new Date(c.created_at);
    date.textContent = d.toLocaleDateString();
    meta.appendChild(author);
    meta.appendChild(date);

    const text = document.createElement("div");
    text.className = "comment-text";
    text.textContent = c.text;

    div.appendChild(meta);
    div.appendChild(text);
    list.appendChild(div);
  });

  panel.appendChild(list);

  // Formulario para añadir comentario nuevo
  const form = document.createElement("form");
  form.className = "comment-form";

  const textarea = document.createElement("textarea");
  textarea.placeholder = "Añadir un comentario…";

  const btn = document.createElement("button");
  btn.type = "submit";
  btn.className = "btn btn-primary";
  btn.textContent = "Enviar";

  form.appendChild(textarea);
  form.appendChild(btn);


  // Evitar que Enter en el textarea active la edición de la celda de tarea
  // y gestionar Enter / Shift+Enter correctamente.
  textarea.addEventListener("keydown", (e) => {
    // Siempre evitamos que el evento suba al <tr> / <tbody>
    e.stopPropagation();

    if (e.key === "Enter") {
      if (e.shiftKey) {
        // Shift+Enter → salto de línea normal
        return;
      }
      // Enter sin Shift → enviar comentario
      e.preventDefault();
      form.requestSubmit(); // dispara el submit del formulario
    }
  });



  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const textVal = textarea.value.trim();
    if (!textVal) return;

    try {
      btn.disabled = true;
      await addCommentToAsana(item.id, textVal, (selectors.asanaToken.value || "").trim());
      textarea.value = "";
      // Recargar comentarios
      const token = (selectors.asanaToken.value || "").trim();
      let comments = await getCommentsFromAsana(item.id, token);
      for (const c of comments) {
        c.text = await decryptCommentText(c.text);
      }
      
	   // Actualizar contador y re-renderizar panel
	   item.commentCount = comments.length;
	   // Buscar el botón dentro del wrapper
	   const wrapper = panel.parentElement;
	   const toggleBtn = wrapper.querySelector(".task-comments-toggle");
	   if (toggleBtn) {
		 toggleBtn.textContent = `💬 Comentarios (${comments.length})`;
	   }
	   renderCommentsPanel(panel, item, comments);

      announce("Comentario añadido correctamente.");
    } catch (err) {
      console.error("Error al añadir comentario:", err);
      announce("Error al añadir comentario. Revisa consola.");
    } finally {
      btn.disabled = false;
    }
  });

  panel.appendChild(form);
}




/* ================================
   Gestión de eventos
   ================================ */

function attachGlobalEvents() {
  // Filtro global
  selectors.globalFilter.addEventListener("input", (e) => {
    const val = e.target.value || "";
    setGlobalFilter(val);
    renderTableBody();
	applyColumnVisibility();
    updateStats();
	resetAutoSaveTimer();
  });

  //Ancho de columnas persistente 
  selectors.configColumnsBtn.addEventListener("click", openColumnConfig);
  selectors.saveColumnConfigBtn.addEventListener("click", saveColumnConfig);

  // Edición de celdas
  const tbody = document.getElementById("dataTableBody");
  tbody.addEventListener("dblclick", onCellActivateEdit);
  tbody.addEventListener("keydown", onCellKeyDown);

  // Botones Guardar / Revertir
  selectors.saveBtn.addEventListener("click", onSaveClick);
  selectors.revertBtn.addEventListener("click", onRevertClick);

  // Tema claro/oscuro
  selectors.themeToggleBtn.addEventListener("click", toggleTheme);

  // Asana: cargar meta y tareas
  selectors.loadMetaBtn.addEventListener("click", async () => {
    await loadWorkspaces();
    const ws = selectors.asanaWorkspace.value;
    if (ws) {
      await loadProjects(ws);
    }
  });

  selectors.asanaWorkspace.addEventListener("change", async () => {
    const ws = selectors.asanaWorkspace.value;
    if (ws) {
      await loadProjects(ws);
    }
  });

  selectors.loadTasksBtn.addEventListener("click", loadTasksFromAsana);

	// Cuando el usuario salga del campo token, cargar automáticamente los workspaces	
	selectors.asanaToken.addEventListener("blur", () => {	  
		const token = (selectors.asanaToken.value || "").trim();	  
		if (token) {		
			loadWorkspaces();	  
		}	
	});	


  // Contraseña de cifrado: al cambiar, reintenta desencriptar los nombres
  selectors.cryptoPassword.addEventListener("change", async () => {
    const pw = selectors.cryptoPassword.value.trim();
    cryptoManager.setMasterPassword(pw || null);

    const state = getState();
    if (!pw || state.items.length === 0) {
      announce(
        "Contraseña vacía o sin datos cargados. Se mostrarán los nombres tal y como vienen de Asana."
      );
      return;
    }

    //const decrypted = await decryptAllTaskNames(state.items);
    //initStore(decrypted);
    //renderTableBody();
    //updateStats();
	
	if (!state.items.length) return;  // evitar sobrescribir

	// 🔥 NO LLAMES initStore AQUÍ
	// initStore(decrypted);

	renderTableBody();   // ya estaba desencriptado desde loadTasksFromAsana()
	applyColumnVisibility();
	updateStats();

    announce("Nombres desencriptados con la contraseña indicada.");
  });
  
  
  // Botones de cabecera: nuevo proyecto / nueva tarea
  selectors.newProjectBtn.addEventListener("click", openNewProjectModal);
  selectors.newTaskBtn.addEventListener("click", openNewTaskModal);

  // Botones "Crear ..." dentro de los modales
  selectors.createProjectBtn.addEventListener("click", createProject);
  selectors.createTaskBtn.addEventListener("click", createTask);
  selectors.createSubtaskBtn.addEventListener("click", createSubtask);
  
  selectors.saveDescriptionBtn.addEventListener("click", saveDescriptionFromModal);

  // Cerrar modales al pulsar en botones con data-close-modal
  document.body.addEventListener("click", (evt) => {
    const closeAttr = evt.target.getAttribute("data-close-modal");
    if (closeAttr) {
      closeModal(closeAttr);
    }
  });

  
  
}

function onHeaderClick(event) {
  const th = event.target.closest("th");
  if (!th || !th.dataset.colKey) return;

  const key = th.dataset.colKey;
  const multi = event.shiftKey || event.metaKey || event.ctrlKey;

  setSort(key, multi);
  renderTableBody();
  applyColumnVisibility();
}

function onHeaderKeyDown(event) {
  if (event.key === "Enter" || event.key === " ") {
    const th = event.target.closest("th");
    if (!th || !th.dataset.colKey) return;
    event.preventDefault();

    const key = th.dataset.colKey;
    const multi = event.shiftKey || event.metaKey || event.ctrlKey;

    setSort(key, multi);
    renderTableBody();
	applyColumnVisibility();
  }
}

function onColumnFilterInput(event) {
  const target = event.target;
  if (!target.dataset.filterKey) return;

  const key = target.dataset.filterKey;
  const val = target.value || "";
  setColumnFilter(key, val);
  renderTableBody();
  applyColumnVisibility();
  updateStats();
  resetAutoSaveTimer();
}

function onCellKeyDown(event) {
  const cell = event.target.closest("td.cell-editable");
  if (!cell) return;

  if (event.key === "Enter") {
    event.preventDefault();
    startEditCell(cell);
  }
}

function onCellActivateEdit(event) {
  const cell = event.target.closest("td.cell-editable");
  if (!cell) return;
  startEditCell(cell);
}

function onSaveClick() {
  const { dirtyRows } = getCounts();
  if (dirtyRows === 0) {
    announce("No hay cambios para guardar.");
    return;
  }
  saveChangesToAsana();
  
}

function onSaveClick_old() {
  const { dirtyRows } = getCounts();
  if (dirtyRows === 0) {
    announce("No hay cambios para guardar.");
    return;
  }
  saveChanges();
  announce(
    `Se han preparado ${dirtyRows} filas modificadas para guardar (revisa la consola).`
  );
}

function onRevertClick() {
  const { dirtyRows } = getCounts();
  if (dirtyRows === 0) {
    announce("No hay cambios que revertir.");
    return;
  }
  if (!confirm("¿Revertir todos los cambios y volver a los datos de Asana cargados?")) {
    return;
  }
  revertAllChanges();
  renderTableBody();
  applyColumnVisibility();
  updateStats();
  announce("Todos los cambios han sido revertidos.");
}

/* ================================
   Edición inline
   ================================ */

function startEditCell(cell) {
  const colKey = cell.dataset.colKey;
  const column = columns.find((c) => c.key === colKey);
  if (!column || !column.editable) return;

  const row = cell.parentElement;
  const itemId = row.dataset.itemId;
  const state = getState();
  const item = state.items.find((i) => i.id === itemId);
  if (!item) return;

  // Terminar editor anterior si lo hay
  if (currentEditor.cell && currentEditor.cell !== cell) {
    cancelCurrentEditor(false);
  }

  const originalValue = item[colKey] ?? "";
  currentEditor = { cell, itemId, column, originalValue };

  // Limpiar contenido
  cell.innerHTML = "";

  let input;
  if (column.type === "select") {
    input = document.createElement("select");
    input.className = "cell-editor-select";
    (column.options || []).forEach((opt) => {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = opt;
      if (opt === originalValue) {
        o.selected = true;
      }
      input.appendChild(o);
    });
  } else {
    input = document.createElement("input");
    input.className = "cell-editor-input";
    input.type = column.type === "number" ? "number" : "text";
    if (column.type === "email") input.type = "email";
    if (column.type === "number") input.min = "0";
    input.value = originalValue != null ? String(originalValue) : "";
  }

  cell.appendChild(input);
  input.focus();
  input.select && input.select();

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitCurrentEditor();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelCurrentEditor(true);
    }
  });

  input.addEventListener("blur", () => {
    if (currentEditor.cell === cell) {
      commitCurrentEditor();
    }
  });
}

function commitCurrentEditor() {
  if (!currentEditor.cell) return;

  const { cell, itemId, column, originalValue } = currentEditor;
  const input = cell.querySelector("input, select");
  if (!input) {
    resetCurrentEditor();
    return;
  }

  const newValueRaw = input.value.trim();
  let newValue = newValueRaw;

  // Validación básica
  let isValid = true;
  if (column.key === "task") {
    isValid = newValue.length > 0;
  }

  if (column.type === "email" && newValue) {
    isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(newValue);
  }

  if (column.type === "number" && newValue) {
    const num = Number(newValue);
    isValid = Number.isFinite(num) && num >= 0;
    newValue = num;
  }

  if (!isValid) {
    cell.classList.add("cell-editable--invalid");
    announce("Valor inválido. Revisa el contenido de la celda.");
    input.focus();
    return;
  } else {
    cell.classList.remove("cell-editable--invalid");
  }

  updateItemField(
    itemId,
    column.key,
    newValueRaw === "" && column.type === "number" ? null : newValue
  );

  // Re-renderizar solo esta celda
  renderCellValue(cell, itemId, column.key);

  resetCurrentEditor();
  markDirtyCells();
  updateStats();
  announce("Celda actualizada correctamente.");
  resetAutoSaveTimer();
}

function cancelCurrentEditor(restoreValue) {
  if (!currentEditor.cell) return;
  const { cell, itemId, column, originalValue } = currentEditor;

  if (restoreValue) {
    renderCellValue(cell, itemId, column.key, originalValue);
  } else {
    renderCellValue(cell, itemId, column.key);
  }

  resetCurrentEditor();
}

function resetCurrentEditor() {
  currentEditor = {
    cell: null,
    itemId: null,
    column: null,
    originalValue: null
  };
}

function renderCellValue(cell, itemId, colKey, forceValue) {
  const state = getState();
  const item = state.items.find((i) => i.id === itemId);
  if (!item) return;

  const column = columns.find((c) => c.key === colKey);
  if (!column) return;

  const value = forceValue ?? item[colKey];

  cell.innerHTML = "";
  let node;

  if (colKey === "status") {
    const span = document.createElement("span");
    span.textContent = value ?? "";
    span.className = `badge ${getStatusBadgeClass(value)}`;
    node = span;
  } else if (colKey === "priority") {
    const span = document.createElement("span");
    span.textContent = value ?? "";
    span.className = `badge ${getPriorityBadgeClass(value)}`;
    node = span;
  } else if (colKey === "estimatedHours") {
    node = document.createTextNode(
      value != null && value !== "" ? String(value) : ""
    );
  } else {
    node = document.createTextNode(value ?? "");
  }

  cell.appendChild(node);
}

/* ================================
   Decoración: dirty, sort, badges
   ================================ */

function markDirtyCells() {
  const state = getState();
  const dirtyMap = state.dirtyMap;
  const tbody = document.getElementById("dataTableBody");
  if (!tbody) return;

  // Limpiar marcas
  tbody.querySelectorAll("td").forEach((td) => {
    td.classList.remove("cell-editable--dirty");
  });

  Object.entries(dirtyMap).forEach(([id, fields]) => {
    const row = tbody.querySelector(`tr[data-item-id="${id}"]`);
    if (!row) return;

    Object.keys(fields).forEach((fieldKey) => {
      const cell = row.querySelector(`td[data-col-key="${fieldKey}"]`);
      if (cell) {
        cell.classList.add("cell-editable--dirty");
      }
    });
  });
}

function updateHeaderSortIndicators() {
  const state = getState();
  const sortDefs = state.sort;
  const thead = selectors.tableWrapper.querySelector("thead");
  if (!thead) return;

  thead.querySelectorAll("th").forEach((th) => {
    const key = th.dataset.colKey;
    if (!key) return;

    const sortDef = sortDefs.find((s) => s.key === key);
    const indicator = th.querySelector(".th-sort-indicator");

    if (!sortDef) {
      th.setAttribute("aria-sort", "none");
      if (indicator) indicator.textContent = "⇅";
    } else {
      const dir = sortDef.direction;
      th.setAttribute("aria-sort", dir === "asc" ? "ascending" : "descending");

      let arrow = dir === "asc" ? "↑" : "↓";
      if (indicator) indicator.textContent = arrow;
    }
  });
}

function getStatusBadgeClass(status) {
  if (!status) return "";
  const s = status.toLowerCase();
  if (s === "pendiente") return "badge-status-pendiente";
  if (s === "en progreso") return "badge-status-en-progreso";
  if (s === "completada") return "badge-status-completada";
  if (s === "bloqueada") return "badge-status-bloqueada";
  return "";
}

function getPriorityBadgeClass(priority) {
  if (!priority) return "";
  const p = priority.toLowerCase();
  if (p === "baja") return "badge-priority-baja";
  if (p === "media") return "badge-priority-media";
  if (p === "alta") return "badge-priority-alta";
  if (p === "crítica" || p === "critica") return "badge-priority-critica";
  return "";
}

/* ================================
   Stats & accesibilidad
   ================================ */

function updateStats() {
  const { total, filtered, dirtyRows } = getCounts();
  const statsBar = selectors.statsBar;

  if (total === 0) {
    statsBar.innerHTML =
      'Sin datos. Carga tareas desde Asana con el botón <strong>📥 Cargar tareas</strong>.';
    return;
  }

  const filteredText =
    filtered === total
      ? `${total} tareas`
      : `${filtered} de ${total} tareas`;
  const dirtyText =
    dirtyRows > 0 ? ` · ${dirtyRows} fila(s) modificada(s)` : "";

  statsBar.innerHTML = `
    <span class="stats-chip">📊 ${filteredText}</span>
    <span class="stats-chip">✏️ Cambios: ${dirtyRows}</span>
    ${dirtyText}
  `;
}

function announce(message) {
  if (!selectors.liveRegion) return;
  selectors.liveRegion.textContent = "";
  setTimeout(() => {
    selectors.liveRegion.textContent = message;
  }, 20);
}

/* ================================
   Tema claro / oscuro
   ================================ */

function toggleTheme() {
  const body = document.body;
  const isDark = body.classList.contains("theme-dark");
  body.classList.toggle("theme-dark", !isDark);
  body.classList.toggle("theme-light", isDark);
}



function applyColumnVisibility() {
  const ths = document.querySelectorAll("th[data-col-key]");
  const tds = document.querySelectorAll("td[data-col-key]");

  ths.forEach(th => {
    const key = th.dataset.colKey;
    th.style.display = columnVisibility[key] === false ? "none" : "";
  });

  tds.forEach(td => {
    const key = td.dataset.colKey;
    td.style.display = columnVisibility[key] === false ? "none" : "";
  });
}

/*Guardar en Asana*/
async function saveChangesToAsana() {
  const dirty = getDirtyItems();
  if (dirty.length === 0) {
    announce("No hay cambios que guardar.");
    return;
  }

  const token = (selectors.asanaToken.value || "").trim();
  if (!token) {
    announce("No has introducido tu token de Asana.");
    return;
  }
  showAutoSaveSpinner()
  announce("Guardando cambios en Asana…");

  for (const item of dirty) {
    let nameToSend = item.task;

    // Si está cifrado, quitamos prefijos >> y reciframos
    if (item.depth > 0) {
      nameToSend = nameToSend.replace(/^(\>\>\s*)+/, "");
    }
    if (cryptoManager.masterPassword) {
      nameToSend = await cryptoManager.encrypt(nameToSend);
    }


    // Descripción
    let notesToSend = item.description || "";
    if (cryptoManager.masterPassword && notesToSend) {
      notesToSend = await cryptoManager.encrypt(notesToSend);
    }



    const body = {
      name: nameToSend,
	  notes: notesToSend,
      // completed en función del estado en la tabla
      completed: item.status === "Completada"

      // aquí puedes añadir más campos si los quieres guardar
      // completed: item.status === "Completada",
      // custom_fields: { … }
    };

    try {
      await fetch(`https://app.asana.com/api/1.0/tasks/${item.id}`, {
        method: "PUT",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ data: body })
      });
    } catch (err) {
      console.error("Error guardando tarea:", item.id, err);
	  hideAutoSaveSpinner();
      announce("Error guardando en Asana. Revisa consola.");
      return;
    }
  }

  markAsSaved();
  renderTableBody();
  updateStats();
  hideAutoSaveSpinner();
  announce("Cambios guardados correctamente en Asana.");
}


/* ================================
   Inicialización
   ================================ */

document.addEventListener("DOMContentLoaded", init);



