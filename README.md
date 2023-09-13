# National blue route round-trip finder

Web application helping walkers find round-trip sections on the national blue route, where you can return to your starting position using public transport.

Website available on https://sztupy.hu/kekkor-kereso

Technical write-up: https://tumblr.esoxy.uk/post/728362854742458368/github-sztupykekkor-kereso

# Data sources

Main data sources used:

* OpenStreetMap Hungary from Geofabrik https://download.geofabrik.de/europe/hungary.html
* National blue route GPX files, including Stamping places from https://www.kektura.hu
* Volánbusz GTFS timetables from https://www.volanbusz.hu/hu/menetrendek/gtfs
* BKK GTFS timetables from https://opendata.bkk.hu/data-sources

Technologies used to convert the data:

* QGis 3.30.2-'s-Hertogenbosch
* PostreSQL 15.4
  * PostGIS 3.4
  * pg_routing 3.5.0
* OpenTripPlanner 2.4.0 (snapshot from 1 september)

## Blue trail data

The three sections of the blue trail were imported to QGis. While the Transdanubian Blue Trail and the Lowlands Blue Trail were nicely joining, there is a slight gap between the Transdanubian Blue Trail and the National Blue Trail. This has been corrected by hand, and the three trails have been merged into a single LineString going from Hollóháza all around the country finishing at Sátoraljaújhely.

The resulting linestring has then been exported using QGis to PostgreSQL into a table called `blue_trail`

The stamp locations have been extracted from this file as well separately, and loaded up into the table `stamp_points`

## Bus stop information

The list of bus and other transit stops have been imported from the `stops.txt` files of both GTFS inputs. The two pointsets have been merged together into one feature and then exported to PostgreSQL to a table called `bus_stops`

## OpenStreetMap routes

The Hungarian database have been imported into PostgreSQL using the `osm2pgrouting` tool. The `mapconfig_for_pedestrian.xml` file was based on https://github.com/pgRouting/osm2pgrouting/blob/main/mapconfig_for_pedestrian.xml but has `trunk` and `trunk_link` roads enabled as well.

```bash
osmosis --read-pbf hungary-latest.osm.pbf --tf accept-ways 'highway=*' --used-node  --write-pbf "hungary-ways.osm.pbf"
osmconvert hungary-ways.osm.pbf --drop-author --drop-version --out-osm -o=hunway.osm
osm2pgrouting -f hunway.osm --conf mapconfig_for_pedestrian.xml --dbname gis --username root -W root --clean
```

## Cleaning up the tables

For us to be able to handle the data correctly we need to clean them up first. This includes:

* Mapping the bus stops and stamping places onto the OSM routing table
* Clustering the stamping places and bus stops so any that are close together are considered as a single one
* Converting the positions from lat/lon to metres to make it easier to calculate distance

### Mapping

For the routing to work we need to route from vertices. In order to do that we need to find the closest vertex to each of the bus stops and stamping places:

```sql
alter table bus_stops add column closest_vertex int;

update bus_stops set closest_vertex = (
  select id from ways_vertices_pgr
    where ST_DWITHIN(bus_stops.geom, ways_vertices_pgr.the_geom, 0.01)
    order by ST_DISTANCE(bus_stops.geom, ways_vertices_pgr.the_geom) ASC LIMIT 1
) where closest_vertex is null;

alter table stamp_points add column closest_vertex int;

update stamp_points set closest_vertex = (
  select id from ways_vertices_pgr
    where ST_DWITHIN(stamp_points.geom, ways_vertices_pgr.the_geom, 0.01)
    order by ST_DISTANCE(stamp_points.geom, ways_vertices_pgr.the_geom) ASC LIMIT 1
) where closest_vertex is null;
```

Both of them first pre-filter the routing vertices to only include close ones (which can be done quickly through a GIST index), then finds the closest one in the filtered list. The search uses a tolerance of around 1km, but in case it doesn't find a match the tolerance can be increased to `0.02` or similar, until all values are handled.

### Clustering

This is a two step process, first let's calculate the cluster value for the stamping points and bus stop points:

```sql
create table busstop_cluster as (select bus_stops.*, ST_ClusterDBSCAN(geom, eps:=0.002, minpoints:=2) over () as cluster_id FROM bus_stops);

create table stamp_cluster as (select stamp_points.*, ST_ClusterDBSCAN(geom, eps:=0.01, minpoints:=2) over () as cluster_id FROM stamp_points);
```

This will cluster all stamping locations within an approx 1km area, and all bus stops within an approx 200m area.

Once we have the `cluster_id`s available we need to have a data source that only includes a single value from each cluster, as well as all points that don't belong to any cluster:

```sql
create table busstop_filtered as (
  (
    select distinct on (cluster_id) * from busstop_cluster
      where cluster_id is not null
      order by cluster_id, id
  )
  UNION
  (select * from busstop_cluster where cluster_id is null)
);


create table stamp_filtered as (
  (
    select distinct on (cluster_id) * from stamp_cluster
      where cluster_id is not null
      order by cluster_id, st_distance(geom, (select geom from blue_trail)) asc
  )
  UNION
  (select * from stamp_cluster where cluster_id is null)
);
```

In the above case for the bus stops we just pick the first one in any given cluster, but for the stamping points we actually select the one closest to the trail. We will use these stamping points then to cut the trail into multiple sections.

### Adding X/Y values

osm2pgrouting already filled in a lot of the values, but it mostly calcuated them using degrees. For some tables it already pre-filled length values in metres as well, but unfortunately not everywhere. To sort this out we will add a couple columns that will help us calculate distance using metres.

```sql
alter table ways_vertices_pgr add column x double precision, add column y double precision;
update ways_vertices_pgr set x = ST_X(ST_Transform(the_geom,3035)), y = ST_Y(ST_Transform(the_geom,3035));

alter table ways add column x1_m double precision, add column x2_m double precision, add column y1_m double precision, add column y2_m double precision;
set x1_m = (select x from ways_vertices_pgr where ways_vertices_pgr.id = source), y1_m = (select y from ways_vertices_pgr where ways_vertices_pgr.id = source), x2_m = (select x from ways_vertices_pgr where ways_vertices_pgr.id = target), y2_m =  (select y from ways_vertices_pgr where ways_vertices_pgr.id = target);
```

First we have calculated the projected X and Y values in metres for the vertices then filled in the same values into the edges table (`ways`) as well. All of these tables have been imported by the `osm2pgrouting` tool.

Note: EPSG:3035 is used as it is a good projection from EPSG:4326 for Europe, including Hungary.

## Routing

This is where we run an A* algorithm between all bus stops and stamping locations that are closer than 5 kilometres from each other (in a straight line)

```sql
CREATE TABLE result_paths AS (
  SELECT * FROM pgr_aStar(
    'SELECT gid as id, source, target, length_m as cost, length_m as reverse_cost, x1_m as x1, y1_m as y1, x2_m as x2, y2_m as y2 FROM ways',
    'SELECT stamp_filtered.closest_vertex as source, busstop_filtered.closest_vertex as target FROM busstop_filtered, stamp_filtered WHERE ST_DISTANCE(busstop_filtered.geom, stamp_filtered.geom, true) < 5000',
    directed => false
  )
);
```

This will give us the resulting pathways between the bus stops and stamping locations. However this doesn't include the path's linestring which we need to calculate further

```sql
create table walking_route as (
    with lines_raw as (
        select
            start_vid,
            end_vid,
            ST_LineMerge( ST_Collect( (SELECT the_geom FROM ways where ways.gid = edge) ORDER BY path_seq) ) AS geom
        FROM result_paths
        WHERE edge != -1
        GROUP BY start_vid, end_vid
    ),
    lines as (
        select
            start_vid,
            end_vid,
            CASE WHEN (select the_geom from ways_vertices_pgr where ways_vertices_pgr.id = start_vid) = st_endpoint(geom)
                THEN ST_reverse(geom)
                ELSE geom
            END AS geom
        from lines_raw
    )
    select
        start_vid,
        end_vid,
        geom,
        st_length(geom) as length,
        st_length(geom, true) as length_m,
        (select id from stamp_filtered order by st_distance(st_startpoint(lines.geom), stamp_filtered.geom) limit 1) as stamp_point,
        (select id from busstop_filtered order by st_distance(st_endpoint(lines.geom), busstop_filtered.geom) limit 1) as bus_point
    from lines
);
```

This one is a bit tricky. That's because while `ST_Collect` will nicely create a linestring of the routing path segments it will sometimes have a direction towards bus stops, while some other times it will have a direction towards the stamping places. We want our routes to always go *from* the stamping places *to* the bus stops. This means we need to reverse the line in case it's endpoint accidentaly matches a stamping location. This is done by the two subqueries creating the `lines_raw` and `lines` temporary tables.

Finally we map the routes back to the actual ID of the stamping places and the bus stops.

## Splitting the trail

The final step is to split the single Blue Trail LineString into multiple sections - each section starts and finishes at one of the stamping points:

```sql
create table blue_trail_split as
(
  with
    stamp_points as (
      select st_closestpoint( (select geom from blue_trail), geom) as geom,
        st_linelocatepoint( (select geom from blue_trail), geom) as order
      from stamp_filtered
    ),
    ordered_points as (
      select st_collect(geom order by "order") as res
      from stamp_points
    ),
    split_dump as (
      select (st_dump(st_split(st_snap(geom, ordered_points.res, 0.0001), ordered_points.res))) as dump
      from blue_trail, ordered_points
    )
  select
    (dump).path[1] as section_id,
    (dump).geom as geom,
    st_length((dump).geom) as length,
    st_length((dump).geom, true) as length_m,
    (select id from stamp_filtered order by st_distance(st_startpoint((dump).geom), geom) limit 1) as start_point,
    (select id from stamp_filtered where id != (select id from stamp_filtered order by st_distance(st_startpoint((dump).geom), geom) limit 1) order by st_distance(st_endpoint((dump).geom), geom) limit 1) as end_point
  from split_dump
);

update blue_trail_split set section_id = 307 where section_id = 1;
update blue_trail_split set section_id = section_id - 1;
```

There are multiple steps here, so let's look at them in order:

* `stamp_points`: This finds where each of the stamping locations are on the blue trail as a percentage, where the starting point of the trail is considered 0%, and the endpoint is 100%
* `ordered_points`: The previous points ordered from start to finish then converted to a MultiPoint geometry
* `split_dump`: This is yet again a mult-step process:
  * `st_snap`: We need to make sure that all points lie *exactly* on the line, otherwise split will skip those points
  * `st_split`: We split it out the single long Blue Trail line into a `MultiLineString` containing the sections
  * `st_dump`: Finally we split out the `MultiLineString` into multiple `LineString` elements

Once we have the segments we fill their details up, including which segment they are (starting from 1), their length, and the link to their starting and finishing stamping places.

Also note that while the result is in a nice order, for some reason the first section returned is actually the last section. There is likely a way to solve this automatically, but in this case I just moved the first section to the end manually. (There were 306 sections that will be nunbered 1-306)

## Exporting the tables

Now that we have the relevant data we need to export them to GeoJSON. I have used QGIS for this:

* `blue_trail_split` is exported as `kekkor.geojson`
* `walking_route` is exported as `routes.geojson`
* `busstop_filtered` is exported as `busstops.geojson`
* `stamps_filtered` is exported as `stamps.geojson`

All of these files can be found in the `import` directory.

## Loading up trip information

We need to set up OpenTripPlanner to support the relevant public transport systems.

First let's create a directory called `hungary` and copy the following files inside it:

* `hungary-latest.osm.pbf`
* `volanbusz_gtfs.zip`
* `budapest_gtfs.zip`

Afterwards we can start building the trip database. I am using the docker version of OTP for this:

```bash
docker run --rm -v "/$(pwd)/hungary:/var/opentripplanner" -e JAVA_OPTS="-Xmx8g" docker.io/opentripplanner/opentripplanner:latest --build --save
```

This will require at least 8GB of RAM, but maybe more, so make sure your docker host has enough memory to handle this.

Once the bulding finishes you can now start up OpenTripPlanner in API mode:

```bash
docker run -it --rm -p 8080:8080 -v "/$(pwd)/hungary:/var/opentripplanner" docker.io/opentripplanner/opentripplanner:latest --load --serve
```

To check everything is working go to http://localhost:8080/ and check if routing works as expected - it should return a valid bus route between two points you pick.

## Calculating viable routes

The `calculate.rb` is a ruby script that will try to calculate feasible public transport routes between the various sections. It will do this the following way:

1. Go through each possible Blue Trail ways that start and end at a stamping location and are at most 50km in length.
2. Check the start and end stamping points of this way, then look at all the different walking routes we calculated from these stamping points to their nearest bus stops
3. Gather all possible combinations of these and from the shortest possible way to the longest go through each option and ask OpenTripPlanner to plan a route between them
4. Do this until we have enough alternatives then continue with the next Blue Trail section

To run this simply use:

```bash
./calculate.rb > results.txt
```

## Filter out viable routes and generate JSON data the web app is using

The final is step is loading up all the various alternatives the previous tool has split out and filter them out to at most 3 for each section. The 3 options we will keep are:

* The one with the least amount of walking (outside of the Blue Trail)
* The one with the least amount of public transit (in minutes)
* The one which is somewhere between the previous two

We will also save the various ways and routes as encoded polyline in the resulting JSON as that takes the least amount of space. The resulting file is already around 20-25MB in size though.

```bash
./extract.rb results.txt > result.json
```

# Starting the app

Copy the `result.json` into the `files` folder. Afterwards run

```bash
npm run start
```

You will get a URL where the app is running.
# Building and deploying the app

Run

```bash
npm run build
```

Then commit the `docs` directory and push it up for Github Pages to deploy

# LICENSE

The app is licensed under the MIT License.
The GIS data are licensed under the ODbL License.
I am unaware of the offical licensing statuses of the GTFS sources and the offical Blue Trail route tack file, they are however available to the public to use.
