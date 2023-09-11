#!/usr/bin/env ruby

require 'json'
require 'rest-client'

blue_route = JSON.parse(File.read('kekkor.geojson'))['features'].to_h{|item| [item['properties']['section_id'], item]}.freeze

bus_stops = JSON.parse(File.read('busstops.geojson'))['features'].to_h{|item| item[:links] = {}; [item['properties']['id'], item]}.freeze
stamps = JSON.parse(File.read('stamps.geojson'))['features'].to_h{|item| item[:links] = {}; [item['properties']['id'], item]}.freeze



JSON.parse(File.read('routes.geojson'))['features'].each do |link|
  pr = link['properties']
  stamp_id = pr['stamp_point']
  bus_id = pr['bus_point']

  bus_stops[bus_id][:links][stamp_id] = link
  stamps[stamp_id][:links][bus_id] = link
end

start_id = 1
end_id = 1

while blue_route[start_id]
  length = 0
  (start_id..end_id).each do |i|
    length += blue_route[i]['properties']['length_m']
  end

  if length > 50000
    start_id += 1
    end_id = start_id
    next
  end

  start_stamp = blue_route[start_id]['properties']['start_point']
  end_stamp = blue_route[end_id]['properties']['end_point']

  p "-------------------------------------------------"
  p [start_id, end_id, length, start_stamp, end_stamp]

  bus_options = stamps[start_stamp][:links].keys.product(stamps[end_stamp][:links].keys).flat_map do |a,b|
    aa = stamps[start_stamp][:links][a]
    bb = stamps[end_stamp][:links][b]
    l_a = aa['properties']['length_m']
    l_b = bb['properties']['length_m']

    [
      {
        a_id: a,
        b_id: b,
        a_link: aa,
        b_link: bb,
        a: bus_stops[a],
        b: bus_stops[b],
        a_m: l_a,
        b_m: l_b,
        total: l_a + l_b,
        rev: false
      },
      {
        a_id: b,
        b_id: a,
        a_link: bb,
        b_link: aa,
        a: bus_stops[b],
        b: bus_stops[a],
        a_m: l_b,
        b_m: l_a,
        total: l_a + l_b,
        rev: true
      },
    ]
  end.sort_by{|a| a[:total]}

  min_walk = Float::INFINITY
  min_travel = Float::INFINITY
  viable = []
  found_count = 0

  bus_options.each do |bus|
    p "XXX #{bus[:a]['geometry']['coordinates'].reverse} - #{bus[:b]['geometry']['coordinates'].reverse} - #{bus[:total]}"

    response = JSON.parse(RestClient.get('http://localhost:8080/otp/routers/default/plan', {
      params: {
        fromPlace: bus[:a]['geometry']['coordinates'].reverse.join(','),
        toPlace: bus[:b]['geometry']['coordinates'].reverse.join(','),
        time: '5:00am',
        date: '09-09-2023',
        mode: 'TRANSIT,WALK',
        arriveBy: 'false',
        debugItineraryFilter: 'LIST_ALL',
        searchWindow: 30000,
        additionalParameters: 'searchWindow',
        locale: 'en'
      }
    }).body)

    found = false
    response['plan']['itineraries'].each do |itinerary|
      if itinerary['transitTime'] != 0 && itinerary['duration'] < 7200
        min_walk = [min_walk, bus[:total] + itinerary['walkDistance'] * 2].min
        min_travel = [min_travel, itinerary['duration']].min
        viable << {
          data: [start_id, end_id, length, start_stamp, end_stamp],
          bus: bus.reject{|k,v| %w{a_link b_link a b}.include?(k.to_s)},
          itinerary: itinerary,
          walk: bus[:total] + itinerary['walkDistance'],
          walk_bias: bus[:total] + itinerary['walkDistance']*2,
          reversed: bus[:rev]
        }
        found = true
      end
    end

    found_count +=1 if found

    if min_walk-bus[:total] < 0 && (min_travel < 3600 || viable.length >= 30 || found_count >= 10)
      break
    end
  end

  puts viable.to_json

  end_id += 1

  unless blue_route[end_id]
    start_id += 1
    end_id = start_id
  end
end
