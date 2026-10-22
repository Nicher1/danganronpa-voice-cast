(function(root){
  'use strict';
  const ID='dr1-unconfirmed-student',KIND='unconfirmed-student';
  function ensure(board,makeRole){
    const secret=board.secretSettings.games.dr1;
    if(secret.junkoMukuroRevealed)return;
    const progress=board.settings.games.dr1;
    if(progress.voiceChapter<5&&!progress.completedUnits?.[4])return;
    if(!board.roles.some(r=>r.id===ID))board.roles.push(makeRole('Mukuro Ikusaba','???','assets/monopad/dr1/unconfirmed-student.svg',false,{
      id:ID,gameId:'dr1',specialRole:KIND,predictionOnly:true,portraitRevealed:false,
      biography:'Identified as the sixteenth student. Further details have not been confirmed.',voiceProfile:'',voiceRevealChapter:6
    }));
  }
  function setPortrait(role,revealed,image){
    if(role?.specialRole!==KIND)return;
    role.portraitRevealed=!!revealed;
    role.image=revealed?image:'assets/monopad/dr1/unconfirmed-student.svg';
  }
  function entryAt(board,path){return path.reduce((value,key)=>value?.[key],board);}
  function syncIdentity(board,revealed){
    const secret=board.secretSettings.games.dr1;
    const original=board.roles.find(r=>r.gameId==='dr1'&&r.specialRole==='junko-disguise');
    const placeholder=board.roles.find(r=>r.id===ID);
    if(!original)return;
    if(revealed&&placeholder){
      const transfers=[];
      function move(entry,path){
        for(const field of ['victimRoleId','blackenedRoleId'])if(entry[field]===ID){
          entry[field]=original.id;transfers.push([...path,field]);
        }
      }
      for(const [actor,chapters] of Object.entries(board.predictions||{}))for(const [key,entry] of Object.entries(chapters)){
        if(key.startsWith('dr1:'))move(entry,['predictions',actor,key]);
      }
      for(const [key,entry] of Object.entries(board.chapterResults||{}))if(key.startsWith('dr1:'))move(entry,['chapterResults',key]);
      secret.unconfirmedStudentBackup={role:structuredClone(placeholder),transfers,targetId:original.id};
      board.roles=board.roles.filter(r=>r.id!==ID);
    }else if(!revealed&&secret.unconfirmedStudentBackup){
      const backup=secret.unconfirmedStudentBackup;
      if(!placeholder)board.roles.push(backup.role);
      for(const path of backup.transfers){
        const entry=entryAt(board,path.slice(0,-1)),field=path.at(-1);
        if(entry?.[field]===backup.targetId)entry[field]=ID;
      }
      delete secret.unconfirmedStudentBackup;
    }
  }
  const api={ID,KIND,ensure,setPortrait,syncIdentity};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.CastUnconfirmedStudent=api;
})(typeof window==='undefined'?globalThis:window);
