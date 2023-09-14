import Data from './result.json';
import Feature from 'ol/Feature.js';
import Polyline from 'ol/format/Polyline';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import { Stroke, Style}  from 'ol/style.js';
import { OSM, Vector as VectorSource}  from 'ol/source.js';
import { ATTRIBUTION } from 'ol/source/OSM.js';
import { Tile as TileLayer, Vector as VectorLayer } from 'ol/layer.js';
import { useGeographic } from 'ol/proj.js';
import Select from 'ol/interaction/Select'
import { pointerMove } from 'ol/events/condition.js';
import Overlay from 'ol/Overlay';
import { Control, defaults as defaultControls } from 'ol/control.js';
import { MultiLineString } from 'ol/geom';
import GPX from 'ol/format/GPX.js';
import { containsExtent } from 'ol/extent';
import BlueTrail from './kekkor.json';
import GeoJSON from 'ol/format/GeoJSON.js';

const resultsDom = document.getElementById("results");
const resultsTextDom = document.getElementById("resulttext");

const loading = document.getElementById("loading");
const helpCloser = document.getElementById("help-closer");
const helpPage = document.getElementById("help");

const searchPage = document.getElementById("search");

const container = document.getElementById('popup');
const content = document.getElementById('popup-content');
const closer = document.getElementById('popup-closer');

const form = document.getElementById('search-form')

const resultList = document.getElementById('result-list');
const resultListContent = document.getElementById('result-list-content');

const layers = [];
const mipMapLayers = [
  { maxZoom: 9, sources: [] },
  { maxZoom: 7, simplify: 0.01, sources: [] },
  { maxZoom: 4, simplify: 0.05, sources: [] },
  { maxZoom: Number.NEGATIVE_INFINITY, simplify: 0.1, sources: [] }
];
let currentZoom = 1;

let defaultOpacity;
let hoverOpacity;
let selectedOpacity;
let defaultFeatureOpacity;
let selectedFeatureOpacity;
let blueTrailOpacity;

let visibleLayerCount = 0;
let visibleLayers = [];

let mouseCoord = null;
let selectedFeature = null;
let listHoverLayer = null;

useGeographic();

function setOpacity(enabled) {
  if (enabled) {
    defaultOpacity = 0.5;
    hoverOpacity = 1;
    selectedOpacity = 1;
    defaultFeatureOpacity = 0.5;
    selectedFeatureOpacity = 0.75;
    blueTrailOpacity = 0.25;
  } else {
    defaultOpacity = 1;
    hoverOpacity = 1;
    selectedOpacity = 1;
    defaultFeatureOpacity = 1;
    selectedFeatureOpacity = 1;
    blueTrailOpacity = 1;
  }
}

setOpacity(!window.location.search.includes("opaque"));

function dataToString(selectedFeature, data, advanced) {
  let featureString = '';
  const layerData = data.get("data");

  if (selectedFeature) {
    if (selectedFeature.get('type') == 'blue_route') {
      featureString = `<b>Kékkör</b>: ${Math.round(layerData.blue_length)/1000}km<br><b>Start</b>:${layerData.end_stamp.desc}<br><b>Cél</b>:${layerData.start_stamp.desc}`;
    } else if (selectedFeature.get('type') == 'walk_route_start') {
      featureString = `<b>Séta</b>: ${Math.round(layerData.walk_start_length)/1000}km<br><b>Start</b>: ${layerData.start_stamp.desc}<br><b>Cél</b>: ${layerData.start_transit}`;
    } else if (selectedFeature.get('type') == 'walk_route_end') {
      featureString = `<b>Séta</b>: ${Math.round(layerData.walk_end_length)/1000}km<br><b>Start</b>:${layerData.end_transit}<br><b>Cél</b>: ${layerData.end_stamp.desc}`;
    } else if (selectedFeature.get('type') == 'transit') {
      const featureData = selectedFeature.get('data');
      featureString = `<b>Tömegközlekedés</b>: ${Math.round(featureData.duration/60)} perc<br><b>Járat</b>: ${featureData.route.routeShortName}<br><b>Start</b>: ${featureData.route.from.name}<br><b>Cél</b>: ${featureData.route.to.name}<br><b>Indulás</b>: ${featureData.start_times.join(", ")}<br><b>Érkezés</b>: ${featureData.end_times.join(", ")}`;
    } else if (selectedFeature.get('type') == 'transit_walk') {
      const featureData = selectedFeature.get('data');
      featureString = `<b>Átszállás</b>: ${Math.round(featureData.route.distance)}m<br><b>Start</b>: ${featureData.route.from.name}<br><b>Cél</b>:${featureData.route.to.name}`;
    }
  }

  if (!advanced && selectedFeature)
    return `<b>${layerData.end_stamp.name} - ${layerData.start_stamp.name}</b><br><br>${featureString}`;

  let countChange = layerData.transit_legs.reduce((a,c) => a + (c.route.mode == 'WALK' ? 0 : 1),0) - 1;
  let totalTransit = Math.round(calculateTotalBus(layerData)/60);
  let totalWalk = Math.round(calculateTotalWalk(layerData))/1000;
  let blueWalk = Math.round(layerData.blue_length)/1000;

  if (!advanced) {
    return `<b>${layerData.end_stamp.name} - ${layerData.start_stamp.name}</b> ${layerData.type.includes('quickest')?'<span title="legkevesebb tömegközlekedés">⏰</span>':''}${layerData.type.includes('shortest')?'<span title="legkevesebb séta">🏃</span>':''}${layerData.type.includes('optimal')?'<span title="átlagos útvonal">⭐</span>':''}<br><span title="Összes gyaloglás">🚶 ${totalWalk}km</span> / <span title="Kékkörön gyaloglás">🟦 ${blueWalk}km</span> / <span title="tömegközlekedés ideje">🚌 ${totalTransit} perc</span>${countChange>0 ? ` <span title="Átszállások száma">🔄 ${countChange}</span>` : ''}<br><span title="Menetrend szerinti indulások">⏰ ${layerData.transit_legs[0].start_times.join(" / ")}</span><br><br>`;
  }

  let advancedLayerString = `<h1>${layerData.end_stamp.name} - ${layerData.start_stamp.name}</h1><br><b>Kiindulópont</b>: ${layerData.start_transit} @ ${layerData.transit_legs[0].start_times.join(" / ")}<br><b>Tömegközlekedés:</b> ${totalTransit} perc ${countChange > 0 ? `(+ ${countChange} átszállás)`: ''}<br><b>Gyaloglás</b>: ${totalWalk}km<br><b>Ebből kékkör</b>: ${blueWalk}km`;

  let allSections = `<h3>Kiindulópont</h3>${layerData.start_transit}<br><br>`;
  allSections += `<h3>Tömegközlekedés</h3><b>Összesen</b>: ${totalTransit} perc ${countChange > 0 ? `(+ ${countChange} átszállás)`: ''}<br><br>`

  for (let legId=0; legId<layerData.transit_legs.length; legId++) {
    let leg = layerData.transit_legs[legId];
    let nextLeg = layerData.transit_legs[legId+1];
    let legData = ``;

    if (leg.route.mode == 'WALK') {
      legData = `<b>Átszállás egy másik megállóban</b>: ${Math.round(leg.route.distance)}m<br><b>Start</b>: ${leg.route.from.name}<br><b>Cél</b>:${leg.route.to.name}<br><br>`;
    } else {
      legData = `<b>Tömegközlekedés</b>: ${Math.round(leg.duration/60)} perc<br><b>Járat</b>: ${leg.route.routeShortName}<br><b>Start</b>: ${leg.route.from.name}<br><b>Cél</b>: ${leg.route.to.name}<br><b>Indulás</b>: ${leg.start_times.join(", ")}<br><b>Érkezés</b>: ${leg.end_times.join(", ")}<br><br>`;

      if (nextLeg && nextLeg.route.mode != 'WALK') {
        legData += `<b>Átszállás ugyanabban a megállóban</b><br><br>`;
      }
    }

    allSections += legData;
  }

  allSections += `<h3>Séta a bélyegzőhelyre</h3><b>Hossz</b>: ${Math.round(layerData.walk_end_length)/1000}km<br><b>Start</b>:${layerData.end_transit}<br><b>Cél</b>: ${layerData.end_stamp.desc}<br><br>`;

  allSections += `<h3>Kéktúra szakasz</h3><b>Hossz</b>: ${blueWalk}km<br><b>Start</b>:${layerData.end_stamp.name}<br><b>Cél</b>: ${layerData.start_stamp.name}<br><br>`;

  allSections += `<h3>Séta vissza a kiindulópontra</h3><b>Hossz</b>: ${Math.round(layerData.walk_start_length)/1000}km<br><b>Start</b>:${layerData.start_stamp.desc}<br><b>Cél</b>: ${layerData.start_transit}<br><br>`;

  return `${advancedLayerString}<br><br><h2>Kiválasztott szakasz</h2><br>${featureString}<br><br><h2>Szakaszok</h2>${allSections}<h2>Funkciók</h2><a href="#" class="gpx-download">Útvonal letöltése GPX formátumban</a><br><a href="#" class="hide-button">Útvonal elrejtése</a>`;
}

function hideLayer() {
  if (!selectedFeature) return;

  const layer = layers[selectedFeature.get('layerId')];

  const position = visibleLayers.indexOf(layer);
  if (position>=0) {
    visibleLayers.splice(position,1);
  }

  layer.setVisible(false);
  selectedFeature = null;

  resultsDom.classList.remove('contents');

  fillVisibleList();

  return false;
}

function generateGpx() {
  if (!selectedFeature)
    return
  const option = layers[selectedFeature.get('layerId')].get('data');

  const blue_route = new Feature({ name: `Kékkör: ${option.end_stamp.name} - ${option.start_stamp.name}`, desc: `Cél: ${option.start_stamp.desc}`, geometry: new MultiLineString([new Polyline({factor: 1e5}).readGeometry(option.blue_route)])});
  const start_route = new Feature({ name: `Séta vissza: ${option.start_stamp.name} - ${option.start_transit}`, desc: "", geometry: new MultiLineString([new Polyline({factor: 1e5}).readGeometry(option.walk_start_route)])});
  const end_route = new Feature({  name: `Séta a kékkör felé: ${option.end_transit} - ${option.end_stamp.name}`, desc: `Cél: ${option.end_stamp.desc}`, geometry: new MultiLineString([new Polyline({factor: 1e5}).readGeometry(option.walk_end_route)])});
  const transit_route = []
  for (const transit of option.transit_legs) {
    const route = new Feature({ name: `Tömegközlekedés: ${transit.route.from.name} - ${transit.route.to.name}`, desc: transit.route.mode == 'WALK' ? 'Átszállás' : `${transit.route.mode}: ${transit.route.routeShortName} (indulás: ${transit.start_times.join(", ")}; érkezés: ${transit.end_times.join(", ")})`, geometry: new MultiLineString([new Polyline({factor: 1e5}).readGeometry(transit.route.legGeometry.points)])});
    transit_route.push(route);
  }

  const gpx = new GPX();
  const gpxString = gpx.writeFeatures([transit_route, end_route, blue_route, start_route].flat());

  const file = new File([gpxString], `${option.end_stamp.name}-${option.start_stamp.name}.gpx`, {
    type: 'application/gpx+xml',
  })

  const link = document.createElement('a')
  const url = URL.createObjectURL(file)

  link.href = url
  link.download = file.name
  document.body.appendChild(link)
  link.click()

  document.body.removeChild(link)
  window.URL.revokeObjectURL(url)

  return false;
}

function setButtonFunctions() {
  for (let e of document.getElementsByClassName("gpx-download")) {
    e.onclick = generateGpx;
  }
  for (let e of document.getElementsByClassName("hide-button")) {
    e.onclick = hideLayer;
  }
}

function visibleListHover(hoverLayer) {
  let selectedLayer = null;
  if (selectedFeature) {
    selectedLayer = layers[selectedFeature.get('layerId')];
  }

  for (let vl of visibleLayers) {
    if (vl!=selectedLayer) {
      vl.setOpacity(defaultOpacity);
      vl.changed();
    }
  }

  if (hoverLayer) {
    hoverLayer.setOpacity(hoverOpacity);
  }

  listHoverLayer = hoverLayer;
}

function fillVisibleList() {
  resultListContent.innerHTML = '';

  for (const layer of visibleLayers) {
    let a = document.createElement('a');
    a.href = "#";
    a.classList.add('result-link');
    a.onmouseover = () => { visibleListHover(layer); return false; }
    a.onmouseout = () => { visibleListHover(null); return false; }
    a.onclick = () => { clickFeature(layer.getSource().getFeatures()[0]); return false; }
    a.innerHTML = dataToString(null,layer,false);

    if (selectedFeature && layers[selectedFeature.get('layerId')] == layer) {
      a.classList.add('selected-link');
    }

    resultListContent.appendChild(a);
  }

}

function calculateTotalWalk(layerData) {
  return layerData.blue_length + layerData.walk_start_length + layerData.walk_end_length + layerData.transit_legs.reduce((a,c) => a + (c.route.mode == 'WALK' ? c.route.distance : 0),0)
}

function calculateTotalBus(layerData) {
  return layerData.transit_legs.reduce((a,c) => a + (c.route.mode == 'WALK' ? 0 : c.route.duration),0);
}

function orderList(type) {
  if (type == 0) {
    visibleLayers.sort((a,b) => `${a.get('data').end_stamp.name}-${a.get('data').start_stamp.name}`.localeCompare(`${b.get('data').end_stamp.name}-${b.get('data').start_stamp.name}`));
  }
  if (type == 1) {
    visibleLayers.sort((a,b) => calculateTotalWalk(a.get('data')) - calculateTotalWalk(b.get('data')));
  }
  if (type == 2) {
    visibleLayers.sort((a,b) => a.get('data').blue_length - b.get('data').blue_length);
  }
  if (type == 3) {
    visibleLayers.sort((a,b) => calculateTotalBus(a.get('data')) - calculateTotalBus(b.get('data')));
  }
  if (type == 4) {
    visibleLayers.sort((a,b) => a.get('data').transit_legs[0].start_times[0].localeCompare(b.get('data').transit_legs[0].start_times[0]));
  }

  fillVisibleList();

  return false;
}

function runFilter() {
  let maxWalk = parseInt(form.elements.namedItem('max-walk').value)*1000;
  const minBlue = parseInt(form.elements.namedItem('min-blue').value)*1000;
  const maxBus = parseInt(form.elements.namedItem('max-bus').value)*60;
  const searchType = form.elements.namedItem('search-type').value;
  const searchExtent = form.elements.namedItem('search-extent').value;
  const amount = parseInt(form.amount.value);

  if (maxWalk <= minBlue) {
    maxWalk = minBlue/1000+5;
    form.elements.namedItem('max-walk').value = maxWalk+"";
  }

  let validLayers = [];
  var visibleExtent = map.getView().calculateExtent();

  for (let layer of layers) {
    layer.setVisible(false);
    const data = layer.get('data');
    const totalWalk = calculateTotalWalk(data);
    const totalBus = calculateTotalBus(data);

    if (data.blue_length >= minBlue && totalWalk <= maxWalk && maxBus >= totalBus && (searchType == 'all' || data.type.includes(searchType))) {
      if (searchExtent == 'map-touch') {
        let features = layer.getSource().getFeatures();
        for (let feature of features) {
          if (feature.getGeometry().intersectsExtent(visibleExtent)) {
            validLayers.push(layer);
            break;
          }
        }
      } else if (searchExtent == 'map-extent') {
        let features = layer.getSource().getExtent();
        if (containsExtent(visibleExtent,features)) {
          validLayers.push(layer);
        }
      } else {
        validLayers.push(layer);
      }
    }
  }

  for (let i = validLayers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [validLayers[i], validLayers[j]] = [validLayers[j], validLayers[i]];
  }

  visibleLayerCount = 0;
  visibleLayers = [];
  for (let i=0; i< Math.min(amount, validLayers.length); i++) {
    validLayers[i].setVisible(true);
    validLayers[i].changed();
    for (let features of validLayers[i].getSource().getFeatures()) {
      features.changed();
    }
    visibleLayerCount += 1;
    visibleLayers.push(validLayers[i]);
  }

  fillVisibleList();
}

const selectStyle = [
  new Style({
    stroke: new Stroke({
      color: 'black',
      width: 8
    }),
    zIndex: 2000
  }),
  new Style({
    stroke: new Stroke({
      color: [0,128,255],
      width: 7
    }),
    zIndex: 2001
  })
];

const blueTrailStyleFunction = function (feature) {
  return [new Style({
    stroke: new Stroke({
      color: [255,255,255,blueTrailOpacity],
      width: 6
    }),
    zIndex: 1
  }),
  new Style({
    stroke: new Stroke({
      color: [0,0,255,blueTrailOpacity],
      width: 2
    }),
    zIndex: 2
  })]
}

const styleFunction = function (feature) {
  if (selectedFeature && feature.get('id') == selectedFeature.get('id')) {
    return selectStyle;
  }

  if (selectedFeature || listHoverLayer) {
    const layer = layers[feature.get('layerId')];
    const selectedLayer = selectedFeature ? layers[selectedFeature.get('layerId')] : null;

    if (layer == selectedLayer || layer == listHoverLayer) {
      return [
        new Style({
          stroke: new Stroke({
            color: 'black',
            width: 8
          }),
          zIndex: 1000
        }),
        new Style({
          stroke: new Stroke({
            color: feature.get('type') == 'blue_route' ? [0,0,255,selectedFeatureOpacity] :
                   feature.get('type') == 'transit' ? [255,165,0,selectedFeatureOpacity] :
                   [1,50,32,selectedFeatureOpacity],
            width: 4,
          }),
          zIndex: 1001
        })
      ]
    }
  }
  return new Style({
    stroke: new Stroke({
      color: feature.get('type') == 'blue_route' ? [0,0,255,defaultFeatureOpacity] :
             feature.get('type') == 'transit' ? [255,165,0,defaultFeatureOpacity] :
             [1,50,32,defaultFeatureOpacity],
      width: 6,
    }),
    zIndex: 100
  });
};

class ShowSearchControl extends Control {
  constructor(opt_options) {
    const options = opt_options || {};

    const button = document.createElement('button');
    button.innerHTML = '🔎';

    const element = document.createElement('div');
    element.className = 'show-search ol-unselectable ol-control';
    element.appendChild(button);

    super({
      element: element,
      target: options.target,
    });

    button.addEventListener('click', this.showSearchPage.bind(this), false);
  }

  showSearchPage() {
    if (searchPage.style.display == 'block') {
      searchPage.style.display = 'none';
    } else {
      searchPage.style.display = 'block';
      helpPage.style.display = 'none';
    }
  }
}

class ShowHelpControl extends Control {
  constructor(opt_options) {
    const options = opt_options || {};

    const button = document.createElement('button');
    button.innerHTML = '❓';

    const element = document.createElement('div');
    element.className = 'show-help ol-unselectable ol-control';
    element.appendChild(button);

    super({
      element: element,
      target: options.target,
    });

    button.addEventListener('click', this.showHelpPage.bind(this), false);
  }

  showHelpPage() {
    helpPage.style.display = 'block';
    searchPage.style.display = 'none';
    resultList.style.display = 'none';
  }
}

class ShowResultsControl extends Control {
  constructor(opt_options) {
    const options = opt_options || {};

    const button = document.createElement('button');
    button.innerHTML = '🗒️';

    const element = document.createElement('div');
    element.className = 'show-list ol-unselectable ol-control';
    element.appendChild(button);

    super({
      element: element,
      target: options.target,
    });

    button.addEventListener('click', this.showResultsControl.bind(this), false);
  }

  showResultsControl() {
    if (resultList.style.display == 'block') {
      resultList.style.display = 'none';
    } else {
      helpPage.style.display = 'none';
      resultList.style.display = 'block';
    }
  }
}

const selectPointerMove = new Select({
  condition: pointerMove,
  style: selectStyle,
  layers: layers
});

selectPointerMove.on("select", event => {
  for (let feature of event.deselected) {
    if (!selectedFeature || selectedFeature.get('layerId') != feature.get('layerId')) {
      layers[feature.get('layerId')].setOpacity(defaultOpacity);
      layers[feature.get('layerId')].setZIndex(1);
    }
  }
  for (let feature of event.selected) {
    layers[feature.get('layerId')].setOpacity(hoverOpacity);
    layers[feature.get('layerId')].setZIndex(1000);
  }

  if (event.selected[0]) {
    content.innerHTML = dataToString(event.selected[0], layers[event.selected[0].get('layerId')]);
    overlay.setPosition(mouseCoord);
  } else {
    overlay.setPosition(undefined);
  }
});

const overlay = new Overlay({
  element: container
});

closer.onclick = function () {
  selectedFeature = null;
  overlay.setPosition(undefined);
  closer.blur();
  return false;
};

for (let orderType = 0; orderType <= 4; orderType++) {
  document.getElementById(`result-order-${orderType}`).onclick = () => orderList(orderType);
}

const blueTrailVectorSource = new VectorSource({
  features: new GeoJSON().readFeatures(BlueTrail),
});

const blueTrailVectorLayer = new VectorLayer({
  source: blueTrailVectorSource,
  style: blueTrailStyleFunction
});

const TrailLayer = new TileLayer({
  source: new OSM({
    attributions: [
      'Trail overlay: <a href="https://www.waymarkedtrails.org/">Waymarked Trails</a>',
      ATTRIBUTION,
    ],
    opaque: false,
    url: 'https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png'
  }),
  opacity: defaultOpacity,
  visible: false
});

const map = new Map({
  controls: defaultControls().extend([new ShowSearchControl(), new ShowHelpControl(), new ShowResultsControl()]),
  layers: [
    new TileLayer({
      source: new OSM(),
    }),
    TrailLayer,
    blueTrailVectorLayer
  ],
  target: 'map',
  view: new View({
    center: [19.5040, 47.1801],
    zoom: 7,
  }),
});

map.addInteraction(selectPointerMove);
map.addOverlay(overlay);

function clickFeature(clickedFeature) {
  if (clickedFeature) {
    const layer = layers[clickedFeature.get('layerId')];
    resultsTextDom.innerHTML = dataToString(clickedFeature, layer, true);
    resultsDom.classList.add('contents');
    if (!selectedFeature || selectedFeature != clickedFeature) {
      map.getView().fit(layer.getSource().getExtent(), { duration: 1000, padding: [25,25,25,25] });
    } else {
      layers[selectedFeature.get('layerId')].setOpacity(defaultOpacity);
      layers[selectedFeature.get('layerId')].changed();
    }

    selectedFeature = clickedFeature;
    layers[selectedFeature.get('layerId')].setOpacity(selectedOpacity);
    layers[selectedFeature.get('layerId')].changed();
  } else {
    resultsDom.classList.remove('contents');
    if (selectedFeature) {
      let oldFeature = selectedFeature;
      selectedFeature = null;
      layers[oldFeature.get('layerId')].setOpacity(defaultOpacity);
      layers[oldFeature.get('layerId')].changed();
    }
  }

  setButtonFunctions();
  fillVisibleList();
}

map.on('click', function (e) {
  // support for touch devices
  const clickedFeature = map.getFeaturesAtPixel(e.pixel)[0];

  clickFeature(clickedFeature);

  helpPage.style.display = 'none';
  searchPage.style.display = 'none';
  resultList.style.display = 'none';
});

map.on('pointermove', function(evt){
  mouseCoord = evt.coordinate;
});

map.getView().on('change:resolution', () => {
  const zoom = map.getView().getZoom();
  for (let mipMapId in mipMapLayers) {
    const mipMapData = mipMapLayers[mipMapId];
    if (zoom > mipMapData.maxZoom) {
      if (currentZoom != mipMapId) {
        currentZoom = mipMapId;
        for (let layerId in layers) {
          layers[layerId].setSource(mipMapData.sources[layerId]);
        }
      }
      break;
    }
  }
  if (zoom > 11) {
    TrailLayer.setVisible(true);
  } else {
    TrailLayer.setVisible(false);
  }
});

form.elements.namedItem("initiate-search").onclick = function() {
  runFilter();
  return false;
}

form.onchange = function() {
  runFilter();
  return false;
}

for (let optionId in Data) {
  let option = Data[optionId];

  let vectorSource = new VectorSource();

  let vectorLayer = new VectorLayer({
    source: vectorSource,
    style: styleFunction,
    data: option
  });

  let blue_route = new Polyline({factor: 1e5}).readGeometry(option.blue_route);
  vectorSource.addFeature(new Feature({ id: `B${optionId}`, length: option.blue_length, layerId: optionId, type: 'blue_route',geometry: blue_route}));

  let start_route = new Polyline({factor: 1e5}).readGeometry(option.walk_start_route);
  vectorSource.addFeature(new Feature({ id: `S${optionId}`, length: option.walk_start_length, layerId: optionId, type: 'walk_route_start',geometry: start_route}));

  let end_route = new Polyline({factor: 1e5}).readGeometry(option.walk_end_route);
  vectorSource.addFeature(new Feature({id: `E${optionId}`, length: option.walk_end_length, layerId: optionId, type: 'walk_route_end',geometry: end_route}));

  for (let transitId in option.transit_legs) {
    let transit = option.transit_legs[transitId];
    let transit_route = new Polyline({factor: 1e5}).readGeometry(transit.route.legGeometry.points);
    vectorSource.addFeature(new Feature({id: `T${optionId}_${transitId}`, data: transit, length: transit.length, layerId: optionId, type: transit.route.mode == 'WALK' ? 'transit_walk' : 'transit',geometry: transit_route}));
  }

  for (const mipMapData of mipMapLayers) {
    if (!mipMapData.simplify) {
      mipMapData.sources[optionId] = vectorSource;
    } else {
      const source = new VectorSource();
      source.addFeature(new Feature({ id: `B${optionId}`, length: option.blue_length, layerId: optionId, type: 'blue_route',geometry: blue_route.simplify(mipMapData.simplify)}));
      source.addFeature(new Feature({ id: `S${optionId}`, length: option.walk_start_length, layerId: optionId, type: 'walk_route_start',geometry: start_route.simplify(mipMapData.simplify)}));
      source.addFeature(new Feature({id: `E${optionId}`, length: option.walk_end_length, layerId: optionId, type: 'walk_route_end',geometry: end_route.simplify(mipMapData.simplify)}));

      for (let transitId in option.transit_legs) {
        let transit = option.transit_legs[transitId];
        let transit_route = new Polyline({factor: 1e5}).readGeometry(transit.route.legGeometry.points);
        source.addFeature(new Feature({id: `T${optionId}_${transitId}`, data: transit, length: transit.length, layerId: optionId, type: transit.route.mode == 'WALK' ? 'transit_walk' : 'transit',geometry: transit_route.simplify(mipMapData.simplify)}));
      }
      mipMapData.sources[optionId] = source;
    }
  }

  vectorLayer.setSource(mipMapLayers[currentZoom].sources[optionId]);
  vectorLayer.setVisible(false);
  vectorLayer.setOpacity(defaultOpacity);
  vectorLayer.setZIndex(1);
  map.addLayer(vectorLayer);

  layers[optionId] = vectorLayer;
}

runFilter();

helpCloser.style.display = 'block';
loading.style.display = 'none';
helpCloser.onclick = () => {
  helpPage.style.display = 'none';
  return false;
};
