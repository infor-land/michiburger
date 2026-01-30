
// store.js
// Gestión del estado en memoria: datos, filtros, sort y cambios (dirty)

import { cryptoManager } from "./crypto-utils.js";

export const STATUS_VALUES = [
  "Pendiente",
  "En progreso",
  "Completada",
  "Bloqueada"
];

export const PRIORITY_VALUES = ["Baja", "Media", "Alta", "Crítica"];

const state = {
  originalItems: [],
  items: [],
  filters: {
    global: "",
    columns: {
      project: "",
      task: "",
      status: "",
      priority: "",
      owner: "",
      ownerEmail: "",
      dueDateFrom: "",
      dueDateTo: "",
      hoursMin: "",
      hoursMax: ""
    }
  },
  sort: [], // [{ key, direction: 'asc' | 'desc' }]
  dirtyMap: {} // { [id: string]: { [field]: newValue } }
};

export function initStore(items) {
  state.originalItems = structuredClone(items);
  state.items = structuredClone(items);
  state.sort = [];
  state.dirtyMap = {};
}

export function getState() {
  return state;
}

/**
 * Actualiza el filtro global
 */
export function setGlobalFilter(value) {
  state.filters.global = value.toLowerCase();
}

/**
 * Actualiza los filtros por columna
 */
export function setColumnFilter(key, value) {
  if (key in state.filters.columns) {
    state.filters.columns[key] = value;
  }
}

/**
 * Actualiza el estado de ordenación
 * @param {string} key - campo
 * @param {boolean} multi - si se mantiene ordenación previa (Shift)
 */
export function setSort(key, multi) {
  const existingIndex = state.sort.findIndex((s) => s.key === key);

  const cycleDirection = (current) => {
    if (!current) return "asc";
    if (current === "asc") return "desc";
    return null; // se elimina de la ordenación
  };

  if (!multi) {
    const current = existingIndex >= 0 ? state.sort[existingIndex].direction : null;
    const next = cycleDirection(current);
    state.sort = [];
    if (next) {
      state.sort.push({ key, direction: next });
    }
  } else {
    // multi-columna
    if (existingIndex === -1) {
      state.sort.push({ key, direction: "asc" });
    } else {
      const currentDir = state.sort[existingIndex].direction;
      const nextDir = cycleDirection(currentDir);
      if (!nextDir) {
        state.sort.splice(existingIndex, 1);
      } else {
        state.sort[existingIndex].direction = nextDir;
      }
    }
  }
}

/**
 * Devuelve items filtrados y ordenados
 */
export function getVisibleItems() {
  let items = [...state.items];
  const f = state.filters;

  // Filtro global
  if (f.global) {
    const term = f.global;
    items = items.filter((item) => {
      const haystack = [
        item.project,
        item.task,
        item.status,
        item.priority,
        item.owner,
        item.ownerEmail
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(term);
    });
  }

  // Filtros por columna
  const c = f.columns;

  if (c.project) {
    const term = c.project.toLowerCase();
    items = items.filter((i) => (i.project || "").toLowerCase().includes(term));
  }

  if (c.task) {
    const term = c.task.toLowerCase();
    items = items.filter((i) => (i.task || "").toLowerCase().includes(term));
  }

  if (c.status) {
    items = items.filter((i) => i.status === c.status);
  }

  if (c.priority) {
    items = items.filter((i) => i.priority === c.priority);
  }

  if (c.owner) {
    const term = c.owner.toLowerCase();
    items = items.filter((i) => (i.owner || "").toLowerCase().includes(term));
  }

  if (c.ownerEmail) {
    const term = c.ownerEmail.toLowerCase();
    items = items.filter((i) =>
      (i.ownerEmail || "").toLowerCase().includes(term)
    );
  }

  if (c.dueDateFrom) {
    items = items.filter(
      (i) => !i.dueDate || i.dueDate >= c.dueDateFrom
    );
  }

  if (c.dueDateTo) {
    items = items.filter((i) => !i.dueDate || i.dueDate <= c.dueDateTo);
  }

  const min = parseFloat(c.hoursMin);
  if (!Number.isNaN(min)) {
    items = items.filter(
      (i) =>
        typeof i.estimatedHours === "number" && i.estimatedHours >= min
    );
  }

  const max = parseFloat(c.hoursMax);
  if (!Number.isNaN(max)) {
    items = items.filter(
      (i) =>
        typeof i.estimatedHours === "number" && i.estimatedHours <= max
    );
  }

  // Ordenación
  if (state.sort.length > 0) {
    items.sort((a, b) => multiComparator(a, b, state.sort));
  }

  return items;
}

/**
 * Devuelve # de items totales y filtrados
 */
export function getCounts() {
  return {
    total: state.items.length,
    filtered: getVisibleItems().length,
    dirtyRows: Object.keys(state.dirtyMap).length
  };
}

/**
 * Actualiza un campo de un item (y marca dirty)
 */
export function updateItemField(id, key, newValue) {
  // id es string (Asana GID)
  const idx = state.items.findIndex((i) => i.id === id);
  if (idx === -1) return;

  // Cast / normalización simple
  if (key === "estimatedHours") {
    const num = Number(newValue);
    state.items[idx][key] = Number.isFinite(num) ? num : null;
  } else {
    state.items[idx][key] = newValue;
  }

  const original = state.originalItems.find((i) => i.id === id);
  if (!original) return;

  const isSame = isEqualValue(original[key], state.items[idx][key]);

  if (isSame) {
    if (state.dirtyMap[id]) {
      delete state.dirtyMap[id][key];
      if (Object.keys(state.dirtyMap[id]).length === 0) {
        delete state.dirtyMap[id];
      }
    }
  } else {
    if (!state.dirtyMap[id]) state.dirtyMap[id] = {};
    state.dirtyMap[id][key] = state.items[idx][key];
  }
}

/**
 * Revertir todos los cambios a los datos originales
 */
export function revertAllChanges() {
  state.items = structuredClone(state.originalItems);
  state.dirtyMap = {};
}

/**
 * Stub de guardado: imprime payload en consola
 */
 


export async function saveChanges() {
  const changedIds = Object.keys(state.dirtyMap);
  const payload = [];

  for (const id of changedIds) {
    const item = state.items.find((i) => i.id === id);
    if (!item) continue;

    // Nombre en claro que estás viendo/EDITANDO en la tabla
    let plainName = item.task || "";

    // Si usas prefijos visuales para subtareas (ej. ">> "), quítalos antes de cifrar
    if (item.isSubtask && plainName.startsWith(">>")) {
      plainName = plainName.replace(/^>>\s*/, "");
    }

    let nameForAsana = plainName;
    if (cryptoManager.masterPassword) {
      nameForAsana = await cryptoManager.encrypt(plainName);
    }

    payload.push({
      gid: item.id,
      plainName,      // por si quieres debug
      encryptedName: nameForAsana
      // aquí añadirías más campos (completed, custom_fields, etc.) si quieres
    });
  }

  console.group("[STORE] Guardar cambios (stub con cifrado listo para Asana)");
  console.log(
    "Payload preparado para enviar a Asana (PUT /tasks/{gid}):",
    JSON.stringify(payload, null, 2)
  );
  console.groupEnd();
}
 
 
export function saveChanges_old() {
  const changedIds = Object.keys(state.dirtyMap);
  const payload = changedIds.map((id) => {
    const item = state.items.find((i) => i.id === id);
    return item;
  });

  console.group("[STORE] Guardar cambios (stub)");
  console.log("Cambios a persistir (ejemplo para API REST / Asana):");
  console.log(JSON.stringify(payload, null, 2));
  console.groupEnd();

  // En una integración real:
  // - Enviar `payload` vía fetch a la API de Asana (PATCH /tasks/{gid})
  // - Si responde OK, actualizar `originalItems` y limpiar dirtyMap.
}

/* ================================
   Utilidades internas
   ================================ */

function multiComparator(a, b, sortDefs) {
  for (const { key, direction } of sortDefs) {
    const res = compareValues(a[key], b[key]);
    if (res !== 0) {
      return direction === "asc" ? res : -res;
    }
  }
  return 0;
}

function compareValues(a, b) {
  // Null / undefined al final
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;

  // Números
  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }

  // Fechas tipo YYYY-MM-DD
  if (isDateString(a) && isDateString(b)) {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }

  // String por defecto
  const sa = String(a).toLowerCase();
  const sb = String(b).toLowerCase();
  if (sa < sb) return -1;
  if (sa > sb) return 1;
  return 0;
}

function isDateString(val) {
  return typeof val === "string" && /^\d{4}-\d{2}-\d{2}$/.test(val);
}

function isEqualValue(a, b) {
  if (typeof a === "number" && typeof b === "number") {
    return a === b;
  }
  return String(a ?? "") === String(b ?? "");
}

//Marcar editados
export function getDirtyItems() {
  const dirty = [];
  for (const id of Object.keys(state.dirtyMap)) {
    const item = state.items.find(i => i.id === id);
    if (item) dirty.push(item);
  }
  return dirty;
}

export function markAsSaved() {
  state.originalItems = structuredClone(state.items);
  state.dirtyMap = {};
}