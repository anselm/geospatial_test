
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
///
/// Client side entity state mirroring and networking
///
/// Manages a concept of 'entities' which are networkable collections of art and gps locations
///
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

class EntityManager {

	constructor(zone,party,logging=0) {
		// zone concept - TODO this may go away or be improved
		this.zone = zone

		// party - this may be improved - used to distinguish players right now but is not non-collidant
		this.party = party

		// some error logging support - a callback handler
		this.logging = logging || function(message) { console.log(message) }

		// tags - default props per entity
		this.tags = "aesthetic"

		// manage entities
		this.entities = {}
	}

	entityUUID(id) {
		// uuid has to be deterministic yet unique for all client instances so build it out of known parts and hope for best
		return this.zone + "_" + this.party + "_" + id
	}

	entityAll(callback) {
		if(!this.entities) return
		for(let uuid in this.entities) {
			callback(this.entities[uuid])
		}
	}

	entitySystemReset() {
		// local flush - not network
		this.entities = {}
	}

	entityQuery(args) {
		// local query only - not network
		let results = []
		this.entityAll((entity)=>{
			if(args.kind && entity.kind == args.kind) results.push(entity)
			// TODO add gps filtering
		})
		return results
	}

	entityUpdateAll(frame) {
		this.entityAll((entity)=>{
			this.entityUpdateOne(frame,entity)
			this.entityDebugging(entity)
		})
	}

	entityUpdateOne(frame,entity) {

		// ignore maps for now
		if(entity.kind=="map") return

		// ignore things that are not gps until a entityGPS exists
		if(entity.kind != "gps" && !this.entityGPS) {
			return
		}

		// attempt to relocalize
		XRAnchorCartography.featureRelocalize(frame,entity,this.entityGPS)

		// attempt to set an entityGPS
		if(entity.kind == "gps" && entity.relocalized && !this.entityGPS) {
			this.entityGPS = entity
		}

		// publish changes? (only entities that have a location can have their changes published)
		if(!entity.published && entity.cartesian) {
			this.entityPublish(entity)
			entity.published = 1
		}
	}

	///
	/// Make a gps entity - at the moment multiple of these are allowed - note that this.entityGPS is not set here (since it could arrive over network)
	///

	async entityAddGPS(frame) {
		let feature = await XRAnchorCartography.featureAtGPS(frame)
		if(!feature || !feature.gps) {
			this.logging("entityAddGPS: could not make gps anchor!")
			return 0
		}
		let entity = {
			       uuid: this.entityUUID(feature.anchorUID),
			     anchor: feature.anchor,
			  anchorUID: feature.anchorUID,
			        gps: feature.gps || 0,
			  transform: feature.transform || 0,
		    translation: feature.translation || 0,
			orientation: feature.orientation || 0,
			relocalized: feature.relocalized || 0,
			  cartesian: feature.cartesian || 0,
			       name: "a gps anchor at " + feature.gps.latitude + " " + feature.gps.longitude,
			      descr: "a gps anchor at " + feature.gps.latitude + " " + feature.gps.longitude,
			       kind: "gps",
			        art: "cylinder",
			       zone: this.zone,
			       tags: this.tags,
			      party: this.party,
			  published: 0,
			     remote: 0,
			      dirty: 1
		}
		this.entities[entity.uuid] = entity
		return entity
	}

	///
	/// Create an entity as per the users request - it is ok to make these before gps anchors show up
	///

	async entityAddArt(frame) {

		let feature = await XRAnchorCartography.featureAtIntersection(frame,0.5,0.5)
		if(!feature) {
			this.logging("entityAddArt: anchor failed")
			return 0
		}
		let entity = {
			       uuid: this.entityUUID(feature.anchorUID),
			  anchorUID: feature.anchorUID,
			     anchor: feature.anchor,
			        gps: feature.gps || 0,
			  transform: feature.transform || 0,
		    translation: feature.translation || 0,
			orientation: feature.orientation || 0,
			relocalized: feature.relocalized || 0,
			  cartesian: feature.cartesian || 0,
			       name: "art",
			      descr: "some user art",
			       kind: "content",
			        art: "box",
			       zone: this.zone,
			       tags: this.tags,
			      party: this.party,
			  published: 0,
			     remote: 0,
			      dirty: 1
		}
		this.entities[entity.uuid] = entity
		return entity
	}

	///
	/// Create or update a partys position
	/// TODO could fold into above and reduce amount of code

	async entityAddParty(frame) {

		let feature = await XRAnchorCartography.featureAtPose(frame)
		if(!feature) {
			this.logging("entityAddParty: [error] anchor failed")
			return 0
		}
		if(this.entityParty) {
			XRAnchorCartography.removeAnchor(frame,this.entityParty.anchorUID)
			this.entityParty.anchorUID = feature.anchorUID
			this.entityParty.cartesian = 0
			this.entityParty.published = 0
			this.entityParty.dirty = 0
			return this.entityParty
		}
		let entity = {
			       uuid: this.entityUUID(feature.anchorUID),
			  anchorUID: feature.anchorUID,
			        gps: feature.gps || 0,
			  transform: feature.transform || 0,
		    translation: feature.translation || 0,
			orientation: feature.orientation || 0,
			relocalized: feature.relocalized || 0,
			  cartesian: feature.cartesian || 0,
			       name: this.party,
			      descr: "a representation for a person named " + this.party,
			       kind: "party",
			        art: "cylinder",
			       zone: this.zone,
			       tags: this.tags,
			      party: this.party,
			  published: 0,
			     remote: 0,
			      dirty: 1
		}
		this.entities[entity.uuid] = this.entityParty = entity
		return entity
	}

	async mapSave(frame) {

		// a slight hack - make and fully prep a gps anchor if one is not made yet

		let entity = this.entityGPS
		if(!entity) {
			// if no gps entity was added then force add one now
			entity = await this.entityAddGPS(frame)
			if(!entity) {
				this.logging("entity MapSave: [error] failed to add gps entity - no gps yet?")
				return
			}
			// force promote the entity to the gps entity
			XRAnchorCartography.featureRelocalize(frame, entity)
			if(!entity.relocalized) {
				this.logging("entity mapSave: [error] failed to relocalize entity - which is odd")
				return
			}
			this.entityGPS = entity
		}

		// for now the entity is also written into the map - it's arguable if this is needed - will likely remove since it's mostly just extraneous TODO
		// the idea was that I could search for maps, but if I assume each map has one and only one gps anchor entity then I know what maps exist based on entities whose kind is == gps

		this.logging("entity mapSave: UX saving map")

		let results = await frame._session.getWorldMap()
		if(!results) {
			this.logging("entity MapSave: [error] this engine does not have a good map from arkit yet")
			return 0
		}
		const data = new FormData()
		// TODO - this kind of mixes concerns badly - if I pick a single anchor to associate the map with then this is not needed
		data.append('blob',        new Blob([results.worldMap], { type: "text/html"} ) )
		data.append('uuid',        "MAP" + entity.uuid )
		data.append('anchorUID',   entity.anchorUID )
		data.append('name',        entity.name)
		data.append('descr',       entity.descr)
		data.append('kind',        "map" )
		data.append('art',         entity.art )
		data.append('zone',        entity.zone )
		data.append('tags',        entity.tags )
		data.append('party',       entity.party )
		data.append('relocalized', 0)
		data.append('latitude',    entity.gps.latitude )
		data.append('longitude',   entity.gps.longitude )
		data.append('altitude',    entity.gps.altitude )
		let response = await fetch('/api/map/save', { method: 'POST', body: data })
		let json = await response.json()
		this.logging("entity mapSave: succeeded")
		return json		
	}

	async  mapLoad(session,filename) {

		// observe anchors showing up again - this code doesn't have to do any work since update loop will busy poll till it rebinds anchors to maps
		if (!this.listenerSetup) {
			this.listenerSetup = true
			session.addEventListener(XRSession.NEW_WORLD_ANCHOR,(event) => {
				this.logging(event.detail.uid + " << arkit callback - saw an anchor re-appear " )
			})
		}

		// fetch map itself - which will eventually resolve the anchor loaded above
		let response = await fetch("uploads/"+filename)
		let data = await response.text()
		let results = await session.setWorldMap({worldMap:data})
		this.logging("entity mapLoad: a fresh map file arrived " + filename )
	}


	//////////////////////////////////////////////////////////////////////////////////
	// network
	//////////////////////////////////////////////////////////////////////////////////

	async entityNetworkRestart(args) {
		// flush local entities
		if(!this.socket) {
			this.socket = io()
			this.socket.on('publish', this.entityReceive.bind(this) )
			this.socket.emit('location',args.gps)
		}
		// reload or load everything (typically AFTER the network is started to avoid missing chatter)
		await this.entityLoadAll(args.gps)
	}

	///
	/// Get everything near player gps from server (typically AFTER starting to listen to ongoing chatter due to possibility of a gap)
	///

	async entityLoadAll(gps) {
		// load all the entities from the server in one go - and rebinding/gluing state back together will happen later on in update()
		if(!gps) {
			this.logging("entityLoadAll: this engine needs a gps location before loading maps")
			return 0
		}
		this.logging("entityLoadAll: getting all entities near latitude="+gps.latitude+" longitude="+gps.longitude)

		let response = await fetch("/api/entity/query", {
			method: 'POST',
		    headers: {
		      'Accept': 'application/json',
		      'Content-Type': 'application/json'
		    },
    		body: JSON.stringify({gps:gps})
		})

		let json = await response.json()

		let count = 0
		for(let uuid in json) {
			count = count + 1
			let entity = json[uuid]
			this.entities[entity.uuid]=entity
			entity.published=1
			entity.remote=1
			entity.dirty=1
			entity.relocalized=0
			this.logging(entity.anchorUID + " << entityLoadAll: made entity kind="+entity.kind+" uuid="+entity.uuid+" anchor="+entity.anchorUID)
		}
		this.logging("entityLoadAll: loading done - entities in total is " + count )
		return 1
	}

	///
	/// Receive an entity over network - may Create/Revise/Update/Delete an entity
	/// TODO deletion events
	///

	entityReceive(entity) {
		// TODO rebuild trans/rot
		entity.cartesian = entity.cartesian ? new Cesium.Cartesian3(entity.cartesian.x,entity.cartesian.y,entity.cartesian.z) : 0
		entity.published = 1
		entity.remote = 1
		entity.dirty = 1
		entity.relocalized = 0
		let previous = this.entities[entity.uuid]
		if(!previous) {
			this.entities[entity.uuid] = entity
			this.logging("entityReceive: saving new remote entity " + entity.uuid)
			console.log(entity)
		} else {
			// scavenge choice morsels from the network traffic and throw network traffic away
			previous.cartesian = entity.cartesian
			previous.art = entity.art
			previous.tags = entity.tags
			previous.gps = entity.gps
			this.logging("entityReceive: remote entity found again and updated " + entity.uuid)
			console.log(entity)
		}
	}

	///
	/// Publish an entity to network
	/// I prefer to publish an extract because there may be other state stored in entity locally that I don't want to publish
	/// TODO when publishing an update there's no point in sending all the fields
	///

	entityPublish(entity) {

		if(!entity.cartesian) {
			this.logging("entityPublish: [error] entity has no cartesian " + entity.uuid )
			return
		}

		entity.published = 1

		if(!this.socket) {
			return
		}

		let blob = {
			       uuid: entity.uuid,
			  anchorUID: entity.anchorUID,
			        gps: entity.gps || 0,
		    translation: entity.translation || 0,
			orientation: entity.orientation || 0,
			relocalized: entity.relocalized || 0,
			  cartesian: entity.cartesian || 0,
			       name: entity.name,
			      descr: entity.descr,
			       kind: entity.kind,
			        art: entity.art,
			       zone: entity.zone,
			       tags: entity.tags,
			      party: entity.party,
			  published: entity.published || 0,
			     remote: entity.remote || 0,
			      dirty: entity.dirty || 0
		}
		this.socket.emit('publish',blob);
	}

	/* TODO - I need some kind of admin flush mode
	async flushServer() {

		// flush server
		let response = await fetch("/api/entity/flush",{ method: 'POST', body: this.zone })
		console.log("server state after flush")
		console.log(response)

		this.flushClient()
	}
	*/

	entityDebugging(entity) {
		if(entity.debugged) return
		if(!entity.pose) return
		entity.debugged = 1
		this.logging("entityDebug: *********************** entity status " + entity.anchorUID + " relocalized="+entity.relocalized + " kind="+entity.kind)
		if(entity.anchor) this.logging("  *** is using an anchor *** kind=" + entity.kind)
		if(entity.pose) this.logging("entity=" + entity.anchorUID + " is at x=" + entity.pose.x + " y="+entity.pose.y+" z="+entity.pose.z)
		if(entity.gps) this.logging("entity=" + entity.anchorUID + " latitude="+entity.gps.latitude+" longitude="+entity.gps.longitude+" accuracy="+entity.gps.accuracy)
		if(entity.cartesian) this.logging("entity cartesian x=" + entity.cartesian.x + " y=" + entity.cartesian.y + " z="+entity.cartesian.z)
		console.log(entity)
	}

}
