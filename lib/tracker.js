var events = require('events');

var Tracker = function (persister) {
	this.persister = persister;
	this.waitingClientsById = {};
	this.waitingClientsByResource = {};
};

Tracker.prototype.createClient = function (id) {
	console.log('Creating client #' + id);

	var client = {};
	client.id = id;
	client.resources = {};
	client.events = new events.EventEmitter();

	this.waitingClientsById[client.id] = client;

	return client;
};

Tracker.prototype.subscribe = function (client, resource, version) {
	version = ('' + version);

	console.log('Request to subscribe client #' + client.id + ' for: ' + resource + ' (@' + version + ')');

	if (resource in client.resources) {
		return;
	}

	client.resources[resource] = version;

	if (! (resource in this.waitingClientsByResource)) {
		this.waitingClientsByResource[resource] = {};
	}
	this.waitingClientsByResource[resource][client.id] = client;

	this.catchUpClient(client, resource);
};

Tracker.prototype.unsubscribe = function (client, resource) {
	console.log('Request to unsubscribe client #' + client.id + ' from: ' + resource);

	if (! (resource in client.resources)) {
		return;
	}

	delete this.waitingClientsByResource[resource][client.id];
	delete client.resources[resource];

	console.log('Client #' + client.id + ' now subscribed to resources: ' + JSON.stringify(client.resources));
};

Tracker.prototype.deleteClient = function (client) {
	console.log('Deleting client for #' + client.id);

	for (var resource in client.resources) {
		this.unsubscribe(client, resource);
	}

	delete this.waitingClientsById[client.id];
};

Tracker.prototype.publish = function (resource, version, data) {
	resource = ('' + resource);
	version = ('' + version);

	console.log('Received publish request for resource ' + resource + ', version: ' + version);

	this.persister.set(resource, {"version": version, "data": data});

	if (! (resource in this.waitingClientsByResource)) {
		return;
	}

	var clients = this.waitingClientsByResource[resource];
	for (var clientIdx in clients) {
		this.catchUpClient(clients[clientIdx], resource);
	}
};

Tracker.prototype.catchUpClient = function (client, resource) {
	var clientVersion = client.resources[resource];

	var isUpToDate = function (current, target) {
		if (target === null) {
			//The target is unknown, so whatever the client has is "up to date".
			return true;
		}

		if (target.length > current.length) {
			//("502" > "51") - this is not so, but we want it to be.
			return false;
		}

		return (current >= target);
	};

	this.persister.get(resource, function (result) {
		var latestVersion = (result !== null ? result.version : null),
			data = (result !== null ? result.data : data);

		if (isUpToDate(clientVersion, latestVersion)) {
			console.log('Client #' + client.id + ' is up to date (' + clientVersion + ') for resource: ' + resource);
			return;
		}

		client.resources[resource] = latestVersion;
		console.log('Notifying client #' + client.id + ' for version ' + latestVersion + ' on ' + resource);

		client.events.emit('outdated', resource, latestVersion, data);
	});
};

module.exports = function (persister) {
	return new Tracker(persister);
};
