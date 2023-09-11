import Data from './result.json';
import Feature from 'ol/Feature.js';
import Polyline from 'ol/format/Polyline';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import {Stroke, Style} from 'ol/style.js';
import {OSM, Vector as VectorSource} from 'ol/source.js';
import {Tile as TileLayer, Vector as VectorLayer} from 'ol/layer.js';
import {useGeographic, toLonLat} from 'ol/proj.js';
import Select from 'ol/interaction/Select'
import {pointerMove} from 'ol/events/condition.js';
import Overlay from 'ol/Overlay';
import {Control, defaults as defaultControls} from 'ol/control.js';
import { MultiLineString } from 'ol/geom';
import GPX from 'ol/format/GPX.js';

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

let layers = [];
let mouseCoord = null;
let selectedFeature = null;
let hoverFeature = null;

useGeographic();

function dataToString(selectedFeature, data, advanced) {
  let featureString = '';
  const layerData = data.get("data");

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

  let layerString = `<b>${layerData.end_stamp.name} - ${layerData.start_stamp.name}</b>`;

  if (!advanced)
    return `${layerString}<br><br>${featureString}`;

  let countChange = layerData.transit_legs.reduce((a,c) => a + (c.route.mode == 'WALK' ? 0 : 1),0) - 1;

  let advancedLayerString = `<h1>${layerData.end_stamp.name} - ${layerData.start_stamp.name}</h1><br><b>Kiindulópont</b>: ${layerData.start_transit} @ ${layerData.transit_legs[0].start_times.join(" / ")}<br><b>Tömegközlekedés:</b> ${Math.round(layerData.transit_legs.reduce((a,c) => a + (c.route.mode == 'WALK' ? 0 : c.route.duration),0)/60)} perc ${countChange > 0 ? `(+ ${countChange} átszállás)`: ''}<br><b>Gyaloglás</b>: ${Math.round(layerData.blue_length + layerData.walk_start_length + layerData.walk_end_length + layerData.transit_legs.reduce((a,c) => a + (c.route.mode == 'WALK' ? c.route.distance : 0),0))/1000}km<br><b>Ebből kékkör</b>: ${Math.round(layerData.blue_length)/1000}km`;

  let allSections = `<h3>Kiindulópont</h3>${layerData.start_transit}<br><br>`;
  allSections += `<h3>Tömegközlekedés</h3><b>Összesen</b>: ${Math.round(layerData.transit_legs.reduce((a,c) => a + (c.route.mode == 'WALK' ? 0 : c.route.duration),0)/60)} perc ${countChange > 0 ? `(+ ${countChange} átszállás)`: ''}<br><br>`

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

  allSections += `<h3>Kéktúra szakasz</h3><b>Hossz</b>: ${Math.round(layerData.blue_length)/1000}km<br><b>Start</b>:${layerData.end_stamp.name}<br><b>Cél</b>: ${layerData.start_stamp.name}<br><br>`;

  allSections += `<h3>Séta vissza a kiindulópontra</h3><b>Hossz</b>: ${Math.round(layerData.walk_start_length)/1000}km<br><b>Start</b>:${layerData.start_stamp.desc}<br><b>Cél</b>: ${layerData.start_transit}<br><br>`;

  return `${advancedLayerString}<br><br><h2>Kiválasztott szakasz</h2><br>${featureString}<br><br><h2>Szakaszok</h2>${allSections}<h2>Funkciók</h2><a href="#" class="gpx-download">Útvonal letöltése GPX formátumban</a><br><a href="#" class="hide-button">Útvonal elrejtése</a>`;
}

function hideLayer() {
  if (!selectedFeature) return;

  const layer = layers[selectedFeature.get('layerId')];

  layer.setVisible(false);
  selectedFeature = null;

  resultsDom.classList.remove('contents');

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

function runFilter() {
  let maxWalk = parseInt(form.elements.namedItem('max-walk').value)*1000;
  const minBlue = parseInt(form.elements.namedItem('min-blue').value)*1000;
  const maxBus = parseInt(form.elements.namedItem('max-bus').value)*60;
  const searchType = form.elements.namedItem('search-type').value;
  const amount = parseInt(form.amount.value);

  if (maxWalk <= minBlue) {
    maxWalk = minBlue/1000+5;
    form.elements.namedItem('max-walk').value = maxWalk+"";
  }

  let validLayers = [];

  for (let layer of layers) {
    layer.setVisible(false);
    const data = layer.get('data');
    const totalWalk = data.blue_length + data.walk_start_length + data.walk_end_length + data.transit_legs.reduce((a,c) => a + (c.route.mode == 'WALK' ? c.route.distance : 0),0);
    const totalBus = data.transit_legs.reduce((a,c) => a + (c.route.mode == 'WALK' ? 0 : c.route.duration),0);


//    console.log([data.blue_length >= minBlue, totalWalk <= maxWalk]);

    if (data.blue_length >= minBlue && totalWalk <= maxWalk && maxBus >= totalBus && (searchType == 'all' || data.type.includes(searchType))) {
      validLayers.push(layer);
    }
  }

  for (let i = validLayers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [validLayers[i], validLayers[j]] = [validLayers[j], validLayers[i]];
  }

  for (let i=0; i< Math.min(amount, validLayers.length); i++) {
    validLayers[i].setVisible(true);
  }
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

const styleFunction = function (feature) {
  if (selectedFeature) {
    const layer = layers[feature.get('layerId')];
    const selectedLayer = layers[selectedFeature.get('layerId')];

    if (feature == selectedFeature) {
      return selectStyle;
    }

    if (layer == selectedLayer) {
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
            color: feature.get('type') == 'blue_route' ? [0,0,255,0.75] :
                   feature.get('type') == 'transit' ? [255,165,0,0.75] :
                   [1,50,32,0.75],
            width: 4,
          }),
          zIndex: 1001
        })
      ]
    }
  }
  return new Style({
    stroke: new Stroke({
      color: feature.get('type') == 'blue_route' ? [0,0,255,0.5] :
             feature.get('type') == 'transit' ? [255,165,0,0.5] :
             [1,50,32,0.5],
      width: 6,
    })
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
  }
}

const selectPointerMove = new Select({
  condition: pointerMove,
  style: selectStyle
});

selectPointerMove.on("select", event => {
  for (let feature of event.deselected) {
    if (!selectedFeature || selectedFeature.get('layerId') != feature.get('layerId')) {
      layers[feature.get('layerId')].setOpacity(0.5);
      layers[feature.get('layerId')].setZIndex(1);
    }
  }
  for (let feature of event.selected) {
    layers[feature.get('layerId')].setOpacity(1);
    layers[feature.get('layerId')].setZIndex(1000);
  }

  if (event.selected[0]) {
    content.innerHTML = dataToString(event.selected[0], layers[event.selected[0].get('layerId')]);
    overlay.setPosition(mouseCoord);
    hoverFeature = event.selected[0];
  } else {
    overlay.setPosition(undefined);
    hoverFeature = null;
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

const map = new Map({
  controls: defaultControls().extend([new ShowSearchControl(), new ShowHelpControl()]),
  layers: [
    new TileLayer({
      source: new OSM(),
    })
  ],
  target: 'map',
  view: new View({
    center: [19.5040, 47.1801],
    zoom: 7,
  }),
});

map.addInteraction(selectPointerMove);
map.addOverlay(overlay);

map.on('click', function (e) {

  // support for touch devices
  const clickedFeature = map.getFeaturesAtPixel(e.pixel)[0];

  helpPage.style.display = 'none';
  searchPage.style.display = 'none';

  if (clickedFeature) {
    const layer = layers[clickedFeature.get('layerId')];
    resultsTextDom.innerHTML = dataToString(clickedFeature, layer, true);
    resultsDom.classList.add('contents');
    if (!selectedFeature || selectedFeature != clickedFeature) {
      map.getView().fit(layer.getSource().getExtent(), { duration: 1000, padding: [25,25,25,25] });
    } else {
      layers[selectedFeature.get('layerId')].setOpacity(0.5);
      layers[selectedFeature.get('layerId')].changed();
    }

    selectedFeature = clickedFeature;
    layers[selectedFeature.get('layerId')].setOpacity(1);
    layers[selectedFeature.get('layerId')].changed();
  } else {
    resultsDom.classList.remove('contents');
    if (selectedFeature) {
      let oldFeature = selectedFeature;
      selectedFeature = null;
      layers[oldFeature.get('layerId')].setOpacity(0.5);
      layers[oldFeature.get('layerId')].changed();
    }
  }

  setButtonFunctions();
});

map.on('pointermove', function(evt){
  mouseCoord = evt.coordinate;
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
  vectorSource.addFeature(new Feature({length: option.blue_length, layerId: optionId, type: 'blue_route',geometry: blue_route}));

  let start_route = new Polyline({factor: 1e5}).readGeometry(option.walk_start_route);
  vectorSource.addFeature(new Feature({length: option.walk_start_length, layerId: optionId, type: 'walk_route_start',geometry: start_route}));

  let end_route = new Polyline({factor: 1e5}).readGeometry(option.walk_end_route);
  vectorSource.addFeature(new Feature({length: option.walk_end_length, layerId: optionId, type: 'walk_route_end',geometry: end_route}));

  for (let transit of option.transit_legs) {
    let transit_route = new Polyline({factor: 1e5}).readGeometry(transit.route.legGeometry.points);
    vectorSource.addFeature(new Feature({data: transit, length: transit.length, layerId: optionId, type: transit.route.mode == 'WALK' ? 'transit_walk' : 'transit',geometry: transit_route}));
  }

  vectorLayer.setVisible(false);
  vectorLayer.setOpacity(0.5);
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
