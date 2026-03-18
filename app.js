const STORAGE_KEY = "birdmapper-records-v1";

const state = {
  map: null,
  activeMarker: null,
  locationMarker: null,
  orthophotoLayer: null,
  studySitesLayer: null,
  records: [],
  editingId: null,
};

const statusText = document.getElementById("statusText");
const recordCount = document.getElementById("recordCount");
const recordsBody = document.getElementById("recordsBody");
const locateBtn = document.getElementById("locateBtn");
const exportBtn = document.getElementById("exportBtn");
const clearAllBtn = document.getElementById("clearAllBtn");

const activeMarkerIcon = L.divIcon({
  className: "bird-marker",
  html: `
    <svg viewBox="0 0 40 56" aria-hidden="true">
      <path d="M20 2C10.06 2 2 10.06 2 20c0 13.45 15.63 30.46 17.44 32.39a.75.75 0 0 0 1.12 0C22.37 50.46 38 33.45 38 20 38 10.06 29.94 2 20 2Z" fill="#d94f3d"/>
      <path d="M20 7.5c-6.9 0-12.5 5.6-12.5 12.5 0 9.15 9.15 20.96 12.5 24.95 3.35-3.99 12.5-15.8 12.5-24.95 0-6.9-5.6-12.5-12.5-12.5Z" fill="#b93829"/>
      <circle cx="20" cy="20" r="8.5" fill="#fff7ef"/>
      <circle cx="20" cy="20" r="4.2" fill="#305f4b"/>
    </svg>
  `,
  iconSize: [28, 40],
  iconAnchor: [14, 40],
  popupAnchor: [0, -34],
});

const locationMarkerIcon = L.divIcon({
  className: "location-marker",
  html: `
    <svg viewBox="0 0 26 26" aria-hidden="true">
      <circle cx="13" cy="13" r="11" fill="rgba(33, 68, 52, 0.18)"/>
      <circle cx="13" cy="13" r="6.5" fill="#214434" stroke="#fffdf7" stroke-width="2"/>
    </svg>
  `,
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

initialize();

function initialize() {
  loadRecords();
  initializeMap();
  renderTable();
  bindGlobalActions();
}

function initializeMap() {
  state.map = L.map("map", {
    zoomControl: true,
    maxZoom: 21,
  }).setView([23.7, 121], 7);

  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      attribution: "&copy; Esri, Maxar, Earthstar Geographics",
      maxZoom: 21,
    }
  ).addTo(state.map);

  loadOrthophotos();
  loadStudySitesLayer();

  state.map.on("click", (event) => {
    openEditorAt(event.latlng);
  });
}

function loadOrthophotos() {
  const images = normalizeOrthophotoImages(window.ORTHOPHOTO_IMAGES);
  if (images.length === 0) {
    return;
  }

  createOrthophotoPane();

  const overlays = images
    .map((image) => createOrthophotoOverlay(image))
    .filter(Boolean);

  if (overlays.length === 0) {
    return;
  }

  state.orthophotoLayer = L.layerGroup(overlays).addTo(state.map);
}

function normalizeOrthophotoImages(images) {
  if (Array.isArray(images)) {
    return images;
  }

  return images ? [images] : [];
}

function createOrthophotoPane() {
  if (state.map.getPane("orthophotoPane")) {
    return;
  }

  const pane = state.map.createPane("orthophotoPane");
  pane.style.zIndex = 300;
  pane.style.pointerEvents = "none";
}

function createOrthophotoOverlay(image) {
  const west = Number(image.west);
  const south = Number(image.south);
  const east = Number(image.east);
  const north = Number(image.north);

  if (![west, south, east, north].every(Number.isFinite)) {
    console.warn("Invalid orthophoto bounds:", image);
    return null;
  }

  const bounds = L.latLngBounds(
    [south, west],
    [north, east]
  );

  return L.imageOverlay(image.path, bounds, {
    pane: "orthophotoPane",
    interactive: false,
    opacity: 1,
  });
}

function loadStudySitesLayer() {
  if (typeof window.STUDY_SITES_KML !== "string" || !window.STUDY_SITES_KML.trim()) {
    console.warn("Study sites KML is not available.");
    return;
  }

  try {
    const layer = createStudySitesLayer(window.STUDY_SITES_KML);
    if (!layer) {
      return;
    }

    state.studySitesLayer = layer.addTo(state.map);

    const bounds = state.studySitesLayer.getBounds();
    if (bounds.isValid()) {
      state.map.fitBounds(bounds.pad(0.08), { maxZoom: 18 });
    }

    statusText.textContent = "研究樣區已載入，可點地圖新增記錄";
  } catch (error) {
    console.error("Failed to load study sites:", error);
    statusText.textContent = "研究樣區載入失敗";
  }
}

function createStudySitesLayer(kmlText) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(kmlText, "application/xml");
  const parseError = xml.querySelector("parsererror");
  if (parseError) {
    throw new Error("Invalid KML document.");
  }

  const placemarks = getElementsByLocalName(xml, "Placemark");
  const layers = placemarks
    .map((placemark) => createPlacemarkLayer(placemark))
    .filter(Boolean);

  return layers.length > 0 ? L.featureGroup(layers) : null;
}

function createPlacemarkLayer(placemark) {
  const name = getDirectChildText(placemark, "name") || "未命名樣區";
  const description = getDirectChildText(placemark, "description");
  const styleUrl = getDirectChildText(placemark, "styleUrl");
  const groupName = getAncestorFolderNames(placemark).join(" / ");
  //const popupHtml = buildStudySitePopup(name, groupName, description);
  const popupHtml = buildStudySitePopup(name);

  const point = getFirstDescendantByLocalName(placemark, "Point");
  if (point) {
    const coordinateText = getFirstDescendantText(point, "coordinates");
    const latlng = parseSingleCoordinate(coordinateText);
    if (!latlng) {
      return null;
    }

    return L.circleMarker(latlng, {
      radius: 5,
      color: "#214434",
      weight: 2,
      fillColor: "#e8f3c8",
      fillOpacity: 0.95,
    }).bindPopup(popupHtml);
  }

  const polygon = getFirstDescendantByLocalName(placemark, "Polygon");
  if (polygon) {
    const rings = getElementsByLocalName(polygon, "outerBoundaryIs")
      .map((boundary) => parseCoordinateRing(getFirstDescendantText(boundary, "coordinates")))
      .filter((ring) => ring.length >= 3);

    if (rings.length === 0) {
      return null;
    }

    return L.polygon(rings, getStudySitePolygonStyle(styleUrl, name)).bindPopup(popupHtml);
  }

  return null;
}

function buildStudySitePopup(name, groupName, description) {
  const parts = [`<strong>${escapeHtml(name)}</strong>`];

  if (groupName) {
    parts.push(`<div>${escapeHtml(groupName)}</div>`);
  }

  if (description) {
    parts.push(`<div>${escapeHtml(description)}</div>`);
  }

  return parts.join("");
}

function getPolygonStyle(styleUrl, name) {
  const value = `${styleUrl ?? ""} ${name}`.toLowerCase();
  if (value.includes("無毒") || value.includes("00ffff")) {
    return {
      color: "#57e36d",
      weight: 2,
      fill: false,
    };
  }

  return {
    color: "#7f3f98",
    weight: 2,
    fill: false,
  };
}

function getElementsByLocalName(root, localName) {
  return Array.from(root.getElementsByTagNameNS("*", localName));
}

function getFirstDescendantByLocalName(root, localName) {
  return getElementsByLocalName(root, localName)[0] ?? null;
}

function getDirectChildText(root, localName) {
  const child = Array.from(root.children).find((element) => element.localName === localName);
  return child?.textContent?.trim() ?? "";
}

function getFirstDescendantText(root, localName) {
  return getFirstDescendantByLocalName(root, localName)?.textContent?.trim() ?? "";
}

function getAncestorFolderNames(node) {
  const names = [];
  let current = node.parentElement;

  while (current) {
    if (current.localName === "Folder") {
      const name = getDirectChildText(current, "name");
      if (name) {
        names.unshift(name);
      }
    }

    current = current.parentElement;
  }

  return names;
}

function parseSingleCoordinate(coordinatesText) {
  const [lng, lat] = splitCoordinateValues(coordinatesText);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return L.latLng(lat, lng);
}

function parseCoordinateRing(coordinatesText) {
  return coordinatesText
    .trim()
    .split(/\s+/)
    .map((coordinateText) => {
      const [lng, lat] = splitCoordinateValues(coordinateText);
      return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
    })
    .filter(Boolean);
}

function splitCoordinateValues(coordinateText) {
  return coordinateText
    .split(",")
    .slice(0, 2)
    .map((value) => Number(value.trim()));
}

function bindGlobalActions() {
  locateBtn.addEventListener("click", locateUser);
  exportBtn.addEventListener("click", exportXlsx);
  clearAllBtn.addEventListener("click", clearAllRecords);

  recordsBody.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }

    const { action, id } = button.dataset;
    const record = state.records.find((item) => item.id === id);
    if (!record) {
      return;
    }

    if (action === "edit") {
      editRecord(record);
      return;
    }

    if (action === "delete") {
      deleteRecord(record.id);
    }
  });
}

function locateUser() {
  if (!navigator.geolocation) {
    statusText.textContent = "此裝置不支援定位";
    return;
  }

  locateBtn.disabled = true;
  statusText.textContent = "定位中...";

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const latlng = L.latLng(
        position.coords.latitude,
        position.coords.longitude
      );

      updateLocationMarker(latlng);
      state.map.setView(latlng, Math.max(state.map.getZoom(), 16));
      locateBtn.disabled = false;
      statusText.textContent = "已定位到目前位置";
    },
    (error) => {
      locateBtn.disabled = false;

      if (error.code === error.PERMISSION_DENIED) {
        statusText.textContent = "定位權限被拒絕";
        return;
      }

      if (error.code === error.POSITION_UNAVAILABLE) {
        statusText.textContent = "無法取得目前位置";
        return;
      }

      if (error.code === error.TIMEOUT) {
        statusText.textContent = "定位逾時";
        return;
      }

      statusText.textContent = "定位失敗";
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    }
  );
}

function updateLocationMarker(latlng) {
  if (state.locationMarker) {
    state.locationMarker.setLatLng(latlng);
    return;
  }

  state.locationMarker = L.marker(latlng, { icon: locationMarkerIcon }).addTo(state.map);
}

function loadRecords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    state.records = raw ? JSON.parse(raw) : [];
  } catch (error) {
    console.error("Failed to load records:", error);
    state.records = [];
  }
}

function persistRecords() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.records));
}

function clearPersistedRecords() {
  localStorage.removeItem(STORAGE_KEY);
}

function openEditorAt(latlng, record = null) {
  clearActiveMarker();

  state.editingId = record ? record.id : null;
  state.activeMarker = L.marker(latlng, { icon: activeMarkerIcon }).addTo(state.map);
  state.map.panTo(latlng);
  statusText.textContent = record ? "正在編輯既有記錄" : "正在新增記錄";

  const defaults = record ?? getDefaultRecord(latlng);
  state.activeMarker.on("popupopen", () => bindPopupForm());
  state.activeMarker.on("popupclose", () => {
    if (state.activeMarker) {
      statusText.textContent = "尚未建立 marker";
    }
  });

  state.activeMarker.bindPopup(buildPopupHtml(defaults), {
    closeButton: true,
    autoClose: false,
    closeOnClick: false,
  });

  state.activeMarker.openPopup();
}

function getDefaultRecord(latlng) {
  const now = new Date();
  const date = getLocalDateString(now);
  const time = now.toTimeString().slice(0, 5);

  return {
    date,
    time,
    lat: roundCoordinate(latlng.lat),
    lng: roundCoordinate(latlng.lng),
    species: "",
    quantity: "",
  };
}

function buildPopupHtml(record) {
  const title = state.editingId ? "編輯觀測資料" : "新增觀測資料";

  return `
    <div class="popup-form">
      <strong>${title}</strong>
      <div class="popup-grid">
        <input id="dateInput" type="date" value="${escapeAttribute(record.date)}" required>
        <input id="timeInput" type="time" value="${escapeAttribute(record.time)}" required>
        <input id="speciesInput" type="text" value="${escapeAttribute(record.species)}" maxlength="100" placeholder="鳥名" required>
        <input id="quantityInput" type="number" value="${escapeAttribute(String(record.quantity))}" min="1" step="1" placeholder="數量" required>
      </div>
      <div class="error-text" id="formError"></div>
      <div class="popup-actions">
        <button id="saveBtn" type="button" disabled>存檔</button>
        <button id="cancelBtn" type="button" class="danger">取消</button>
      </div>
    </div>
  `;
}

function bindPopupForm() {
  const popupRoot = state.activeMarker?.getPopup()?.getElement();
  if (!popupRoot) {
    return;
  }

  const dateInput = popupRoot.querySelector("#dateInput");
  const timeInput = popupRoot.querySelector("#timeInput");
  const speciesInput = popupRoot.querySelector("#speciesInput");
  const quantityInput = popupRoot.querySelector("#quantityInput");
  const saveBtn = popupRoot.querySelector("#saveBtn");
  const cancelBtn = popupRoot.querySelector("#cancelBtn");
  const formError = popupRoot.querySelector("#formError");

  const validate = () => {
    const species = speciesInput.value.trim();
    const quantity = quantityInput.value.trim();
    const quantityValid = /^\d+$/.test(quantity) && Number(quantity) > 0;
    const valid =
      dateInput.value &&
      timeInput.value &&
      species.length > 0 &&
      quantityValid;

    saveBtn.disabled = !valid;
    formError.textContent = valid
      ? ""
      : "請完整填寫所有欄位，且數量需為大於 0 的整數。";
  };

  [dateInput, timeInput, speciesInput, quantityInput].forEach((input) => {
    input.addEventListener("input", validate);
    input.addEventListener("change", validate);
  });

  saveBtn.addEventListener("click", () => {
    const quantity = quantityInput.value.trim();
    if (saveBtn.disabled) {
      validate();
      return;
    }

    const latlng = state.activeMarker.getLatLng();
    const record = {
      id: state.editingId ?? createId(),
      date: dateInput.value,
      time: timeInput.value,
      lat: roundCoordinate(latlng.lat),
      lng: roundCoordinate(latlng.lng),
      species: speciesInput.value.trim(),
      quantity: Number(quantity),
      updatedAt: new Date().toISOString(),
    };

    if (state.editingId) {
      const index = state.records.findIndex((item) => item.id === state.editingId);
      if (index !== -1) {
        state.records[index] = record;
      }
    } else {
      state.records.unshift(record);
    }

    persistRecords();
    renderTable();
    clearActiveMarker();
    state.editingId = null;
    statusText.textContent = "已存檔";
  });

  cancelBtn.addEventListener("click", () => {
    state.editingId = null;
    clearActiveMarker();
    statusText.textContent = "已取消編輯";
  });

  validate();
}

function renderTable() {
  recordCount.textContent = `${state.records.length} 筆`;
  exportBtn.disabled = state.records.length === 0;
  clearAllBtn.disabled = state.records.length === 0;

  if (state.records.length === 0) {
    recordsBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="6">目前沒有資料，請先點選地圖新增記錄。</td>
      </tr>
    `;
    return;
  }

  recordsBody.innerHTML = state.records
    .map(
      (record) => `
        <tr>
          <td>${escapeHtml(record.date)}</td>
          <td>${escapeHtml(record.time)}</td>
          <td>${escapeHtml(record.species)}</td>
          <td>${escapeHtml(String(record.quantity))}</td>
          <td>${escapeHtml(`${record.lat}, ${record.lng}`)}</td>
          <td>
            <div class="row-actions">
              <button type="button" data-action="edit" data-id="${record.id}">編輯</button>
              <button type="button" class="danger" data-action="delete" data-id="${record.id}">刪除</button>
            </div>
          </td>
        </tr>
      `
    )
    .join("");
}

function editRecord(record) {
  const latlng = L.latLng(record.lat, record.lng);
  state.map.setView(latlng, Math.max(state.map.getZoom(), 14));
  openEditorAt(latlng, record);
}

function deleteRecord(id) {
  const confirmed = window.confirm("確定要刪除這筆資料嗎？");
  if (!confirmed) {
    return;
  }

  state.records = state.records.filter((record) => record.id !== id);
  persistRecords();
  renderTable();

  if (state.editingId === id) {
    clearActiveMarker();
    state.editingId = null;
  }

  statusText.textContent = "已刪除 1 筆資料";
}

function clearAllRecords() {
  if (state.records.length === 0) {
    return;
  }

  const confirmed = window.confirm("確定要清空全部資料？此動作無法復原。");
  if (!confirmed) {
    return;
  }

  state.records = [];
  state.editingId = null;
  clearPersistedRecords();
  renderTable();
  clearActiveMarker();
  statusText.textContent = "全部資料已清空";
}

function exportXlsx() {
  if (state.records.length === 0) {
    return;
  }

  const rows = state.records.map((record) => ({
    日期: record.date,
    時間: record.time,
    緯度: record.lat,
    經度: record.lng,
    座標: `${record.lat}, ${record.lng}`,
    鳥種: record.species,
    數量: record.quantity,
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "BirdRecords");

  const today = getLocalDateString(new Date());
  XLSX.writeFile(workbook, `bird-records-${today}.xlsx`);
  statusText.textContent = "已下載 xlsx";
}

function clearActiveMarker() {
  if (!state.activeMarker) {
    return;
  }

  state.map.removeLayer(state.activeMarker);
  state.activeMarker = null;
}

function roundCoordinate(value) {
  return Number(value.toFixed(6));
}

function createId() {
  return `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getLocalDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value ?? "");
}

function getPolygonStyle(styleUrl, name) {
  const value = `${styleUrl ?? ""} ${name}`.toLowerCase();

  if (value.includes("aa00ff")) {
    return {
      color: "#57e36d",
      weight: 2,
      fill: false,
    };
  }

  if (value.includes("00ffff")) {
    return {
      color: "#f2e85c",
      weight: 2,
      fill: false,
    };
  }

  return {
    color: "#7f3f98",
    weight: 2,
    fill: false,
  };
}

function getStudySitePolygonStyle(styleUrl, name) {
  const value = `${styleUrl ?? ""} ${name}`.toLowerCase();

  if (
    value.includes("無毒") ||
    (value.includes("#m_ylw-pushpin") && !value.includes("#msn_ylw-pushpin"))
  ) {
    return {
      color: "#57e36d",
      weight: 2,
      fill: false,
    };
  }

  if (value.includes("慣行") || value.includes("#msn_ylw-pushpin")) {
    return {
      color: "#f2e85c",
      weight: 2,
      fill: false,
    };
  }

  return {
    color: "#7f3f98",
    weight: 2,
    fill: false,
  };
}
