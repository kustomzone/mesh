
const EventEmitter = require('events').EventEmitter;
const util = require('util');

const MAXSIZE = 502;
const HEADERSIZE = 2 + 2 + 1 + 1; //magic + length + number + type;
const MAGICA = 0xf1;
const MAGICB = 0x1f;

const MessageTypes = {
  REQUEST: 0x01,
};

const DataTypes = {
  DATA: 0xEE,
  SYSTEM: 0xEF,
  USER: 0xEA,
};
const RX = 0;
const TX = 1;
const RXT = 2;


var Packet = function (data, num, type) {
  this.size = data.length + HEADERSIZE;
  this.num = num;
  this.buff = new Buffer(this.size + 1);
  data.copy(this.buff, HEADERSIZE, 0); //target, targetStart, sourceStart
  this.buff[0] = MAGICA;
  this.buff[1] = MAGICB;
  this.buff.writeInt16BE(this.size, 2); // we need or not?
  this.buff[4] = num;
  this.buff[5] = type;
};

var Protocol = function () {
  EventEmitter.call(this);
  this.packets = [];
  this.number = 0;
  this.counters = new Buffer(3); //hack
  this.counters[TX] = 0;
  this.counters[RX] = 0;
  this.firstRX = true;
  this.unorderedPackets = [];
};
util.inherits(Protocol, EventEmitter);


Protocol.prototype.rawData = function (data) {
  var startPos = 0;
  if (!data.length)
    return;
  while (startPos != data.length) {
    var packet;
    if (data.length - startPos > MAXSIZE) {
      packet = new Packet(data.slice(startPos, startPos + MAXSIZE), this.counters[TX]++, DataTypes.DATA);
      this.packets[packet.num] = packet;
      this.emit('packet', packet.buff);
      startPos += MAXSIZE;
    } else {
      var size = data.length - startPos;
      packet = new Packet(data.slice(startPos, startPos + size), this.counters[TX]++, DataTypes.DATA);
      this.packets[packet.num] = packet;
      this.emit('packet', packet.buff);
      startPos += size;
    }
  }
};

Protocol.prototype.systemData = function(data, type) {
  if (data.length > 500) {
    console.error('systemData pacet have limit 500 byte');
    return;
  }
  var packetType = type || DataTypes.USER;
  packet = new Packet(data, this.counters[TX]++, packetType);
  this.packets[packet.num] = packet;
  this.emit('packet', packet.buff);
};

Protocol.prototype.packet = function (data) {
  if (this.firstRX) {
    this.counters[RX] = data[4] - 1;
    this.firstRX = false;
  }

  if (!this.checkPacket(data)) {
    this.unorderedPackets.push(data);
    this.unorderedPackets.sort(function (a, b) {
      // problem with 255 and 0
      return a[4] - b[4];
    });
    //console.error('PANIC!!!', this.unorderedPackets.length); //start timer

    if (this.unorderedPackets.length > 10) {
      this.counters[RXT] = this.counters[RX] + 1;
      this.requestPacket(this.counters[RXT]);
    }
  }
  if (this.unorderedPackets.length > 0) {
    this.tryGetPacket();
  }
};

Protocol.prototype.checkPacket = function (data) {
  if (data[0] != MAGICA || data[1] != MAGICB) {
    console.error('Bad packet');
    return false;
  }
  this.counters[RXT] = this.counters[RX] + 1;


  if (data[4] === this.counters[RXT]) {
    if (data[5] === DataTypes.DATA){
      this.counters[RX]++;
      //console.log(`push packet num ${data[4]}`);
      this.emit('data', data.slice(HEADERSIZE, data.length - 1));
      return true;
    }
    if (data[5] === DataTypes.SYSTEM){
      if (data[6] === MessageTypes.REQUEST){
        var num = data[7];
        this.emit('packet', this.packets[num].buff);
      }
      return true;
    }
    if (data[5] === DataTypes.USER) {
      this.counters[RX]++;
      //console.log(`push packet num ${data[4]}`);
      this.emit('systemData', data.slice(HEADERSIZE, data.length - 1));
      return true;
    }
  }
  return false;
};

Protocol.prototype.requestPacket = function (number) {
  //type 1, number 1
  //console.log('requestPacket ' + number);
  var data = new Buffer(2);
  data[0] = MessageTypes.REQUEST;
  data[1] = number;
  this.systemData(data, DataTypes.SYSTEM);
};

Protocol.prototype.tryGetPacket = function () {
  if (!this.unorderedPackets.length)
    return;
  var packet = this.unorderedPackets[0];
  if (this.checkPacket(packet)) {
    this.unorderedPackets.shift();
    this.tryGetPacket();
  }
};


module.exports = Protocol;
