#!/usr/bin/env ruby

require 'bundler/setup'
require "fast_polylines"
require 'rgeo'
require 'rgeo/geo_json'
require 'tzinfo'

# factory = RGeo::Cartesian.factory
# p RGeo::GeoJSON.encode(factory.line_string(FastPolylines.decode("_p~iF~ps|U_ulLnnqC_mqNvxq`@").map{|p| factory.point(*p)}))

tz = TZInfo::Timezone.get('Europe/Budapest')

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

final_result = []

ARGF.each_line do |line|
  if line[0..1] == '[{'
    data = JSON.parse(line)

    data.reject! {|d| Time.at(d['itinerary']['startTime']/1000, in: tz).strftime("%H").to_i > 12 }

    quickest = data.sort_by{|d| [ d['itinerary']['duration'],d['itinerary']['walkDistance'] * 2 + d['bus']['total']] }.first
    shortest = data.sort_by{|d| [ d['itinerary']['walkDistance'] * 2 + d['bus']['total'], d['itinerary']['duration'] ] }.first
    optimal = data.sort_by{|d| d['itinerary']['duration'] + d['itinerary']['walkDistance'] * 2 + d['bus']['total'] }.first

    next unless quickest

    start_section = quickest['data'][0]
    end_section = quickest['data'][1]

    start_stamp = blue_route[start_section]['properties']['start_point']
    end_stamp = blue_route[end_section]['properties']['end_point']

    blue_route_length = 0
    blue_route_line = []
    (start_section..end_section).each do |s|
      blue_route_length += blue_route[s]['properties']['length_m']
      blue_route_line.push(*blue_route[s]['geometry']['coordinates'])
    end

    quickest['type'] = []
    shortest['type'] = []
    optimal['type'] = []

    quickest['type'] << :quickest
    shortest['type'] << :shortest
    optimal['type'] << :optimal

    types = [quickest,shortest,optimal].uniq

    types.each do |opt|
      stst, sten, brl = start_stamp, end_stamp, blue_route_line

      # I messed up first and didn't include the reversed option, this tries to recover the value
      if !stamps[stst][:links][opt['bus']['a_id']] || !stamps[sten][:links][opt['bus']['b_id']]
        opt['reversed'] = true
      end

      if stamps[stst][:links][opt['bus']['a_id']] && stamps[stst][:links][opt['bus']['b_id']] &&
         stamps[sten][:links][opt['bus']['a_id']] && stamps[sten][:links][opt['bus']['b_id']]
         STDERR.puts "warning, all options viable: #{start_stamp} #{end_stamp} #{opt['bus']['a_id']} #{opt['bus']['b_id']}"
         if stamps[stst][:links][opt['bus']['a_id']]['properties']['length_m'] == opt['bus']['a_m']
          STDERR.puts "Potentially Straight"
          opt['reversed'] = false
         end
         if stamps[stst][:links][opt['bus']['b_id']]['properties']['length_m'] == opt['bus']['b_m']
          STDERR.puts "Potentially Reversed"
          opt['reversed'] = true
         end
      end

      if opt['reversed']
        stst, sten = sten, stst
      else
        brl = brl.reverse
      end

      walk_route_start_length = opt['bus']['a_m']
      link = stamps[stst][:links][opt['bus']['a_id']]
      walk_route_start_line = link['geometry']['coordinates'].dup

      legs = opt['itinerary']['legs'].dup

      if legs[0]['mode'] == 'WALK'
        walk_route_start_length += legs[0]['distance']
        walk_route_start_line += FastPolylines.decode(legs[0]['legGeometry']['points']).map{|a,b| [b,a]}
        legs.shift
      end

      walk_route_end_length = opt['bus']['b_m']
      link = stamps[sten][:links][opt['bus']['b_id']]
      walk_route_end_line = link['geometry']['coordinates'].reverse

      if legs[-1]['mode'] == 'WALK'
        walk_route_end_length += legs[-1]['distance']
        walk_route_end_line = FastPolylines.decode(legs[-1]['legGeometry']['points']).map{|a,b| [b,a]} + walk_route_end_line
        legs.pop
      end

      travel_route = []

      legs.each do |leg|
        length = leg['distance']
        duration = (leg['endTime'] - leg['startTime'])/1000
        start_times_day = []
        end_times_day = []

        if leg['mode'] != 'WALK'
          data.each do |dd|
            dd['itinerary']['legs'].each do |other_leg|
              if other_leg['from']['stopId'] == leg['from']['stopId'] && other_leg['to']['stopId'] == leg['to']['stopId']
                st = Time.at(other_leg['startTime']/1000, in: tz).strftime("%H:%M")
                en = Time.at(other_leg['endTime']/1000, in: tz).strftime("%H:%M")

                start_times_day << st
                end_times_day << en
              end
            end
          end
        end

        travel_route << {
          length: length,
          duration: duration,
          route: leg,
          start_times: start_times_day.sort.uniq,
          end_times: end_times_day.sort.uniq
        }
      end

      final_result << {
        type: opt['type'],
        blue_length: blue_route_length,
        blue_route: FastPolylines.encode(brl.map{|a,b| [b.round(4),a.round(4)]}.uniq),
        start_stamp: {
          name: stamps[stst]['properties']['name'],
          desc: stamps[stst]['properties']['desc']
        },
        end_stamp: {
          name: stamps[sten]['properties']['name'],
          desc: stamps[sten]['properties']['desc']
        },
        start_transit: travel_route[0][:route]['from']['name'],
        end_transit: travel_route[-1][:route]['to']['name'],
        walk_start_length: walk_route_start_length,
        walk_start_route: FastPolylines.encode(walk_route_start_line.map{|a,b| [b.round(4),a.round(4)]}.uniq),
        walk_end_length: walk_route_end_length,
        walk_end_route: FastPolylines.encode(walk_route_end_line.map{|a,b| [b.round(4),a.round(4)]}.uniq),
        transit_legs: travel_route
      }
    end
  end
end

puts final_result.to_json
