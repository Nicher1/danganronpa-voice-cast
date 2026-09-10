(function () {
  "use strict";

  // Sanitized public-board snapshot. Authentication, recordings, presence sessions,
  // secret settings, unrevealed roles, and active guesses are intentionally omitted.
  window.DVC_REAL_DATA_SNAPSHOT = {
    snapshot: { revision: 414, updatedAt: "2026-09-10T01:21:15.705988+02:00" },
    version: 5,
    activeTab: "assignments",
    mode: "host",
    selectedActorId: "b252e57d-7370-4c59-a898-fd381593cb33",
    expanded: false,
    settings: {
      maxPerActor: 3,
      gameActive: false,
      currentChapter: 3,
      trackingSinceChapter: 3,
      trialByChapter: { "1": true, "2": true, "3": false, "4": false, "5": false, "6": false },
      completedChapters: { "1": true, "2": true },
      visited: { "1": true, "2": true, "3": true },
      completedGames: { v3: false, dr1: false, dr2: false, dr3anime: false }
    },
    actors: [
      {
        id: "b252e57d-7370-4c59-a898-fd381593cb33",
        name: "Nicher",
        lockedRoleId: "0a99229d-21b7-427d-a0fd-ec88b5a3430d",
        replacementToken: false,
        deathCount: 2,
        history: ["Makoto Naegi", "Kiyotaka Ishimaru", "Yasuhiro Hagakure", "Leon Kuwata", "Kyoko Kirigiri", "Toko Fukawa", "Genocide Jill", "Sakura Ogami", "Celestia Ludenberg", "Aoi Asahina", "Byakuya Togami"]
      },
      {
        id: "0cdb0808-ca8f-41d5-b55b-63533b038526",
        name: "Fae",
        lockedRoleId: null,
        replacementToken: false,
        deathCount: 0,
        history: ["Monokuma", "Kyoko Kirigiri"]
      },
      {
        id: "2a795344-50f2-484b-8a9e-fa47659207cb",
        name: "Fall",
        lockedRoleId: null,
        replacementToken: false,
        deathCount: 0,
        history: ["Toko Fukawa"]
      },
      {
        id: "10b0450b-a6d3-40ee-8c40-c67bafeb3eb5",
        name: "MD",
        lockedRoleId: "a5ed7e1b-f41a-4c07-8d03-a775d866eff9",
        replacementToken: false,
        deathCount: 1,
        history: ["Celestia Ludenberg", "Hifumi Yamada", "Monokuma", "Narrator", "Toko Fukawa", "Genocide Jill", "Sakura Ogami", "Kiyotaka Ishimaru", "Yasuhiro Hagakure", "Aoi Asahina"]
      },
      {
        id: "a4ebdc0d-72f7-465a-b06e-53ee37746723",
        name: "Angel",
        lockedRoleId: null,
        replacementToken: false,
        deathCount: 3,
        history: ["Junko Enoshima", "Aoi Asahina", "Chihiro Fujisaki", "Sayaka Maizono"]
      },
      {
        id: "d048a413-62b3-4802-9f15-af80fea2885a",
        name: "Reika",
        lockedRoleId: "292ea90b-ffb0-4fce-aac3-1158dda9f9f5",
        replacementToken: false,
        deathCount: 1,
        history: ["Byakuya Togami", "Mondo Owada", "Sakura Ogami", "Monokuma", "Aoi Asahina", "Kyoko Kirigiri", "Toko Fukawa", "Celestia Ludenberg", "Alter Ego"]
      },
      {
        id: "c6ed626a-4508-4644-bb31-d4bae4757027",
        name: "Sushi",
        lockedRoleId: null,
        replacementToken: false,
        deathCount: 0,
        history: ["Kyoko Kirigiri", "Sakura Ogami", "Aoi Asahina", "Toko Fukawa"]
      }
    ],
    roles: [
      role("e2b56c3a-8e84-4a53-8b37-41ba6b5d8648", "Monokuma", "Headmaster", null),
      role("0a99229d-21b7-427d-a0fd-ec88b5a3430d", "Makoto Naegi", "Ultimate Lucky Student", "b252e57d-7370-4c59-a898-fd381593cb33"),
      role("8cde0bb0-1023-4a92-b95e-836bafd74b74", "Aoi Asahina", "Ultimate Swimming Pro", null),
      role("eee9f985-faae-4c72-bae8-3d7955b7fbac", "Byakuya Togami", "Ultimate Affluent Progeny", "b252e57d-7370-4c59-a898-fd381593cb33"),
      role("524e1ecd-c7ae-4018-bd80-d2e90ebbfa97", "Celestia Ludenberg", "Ultimate Gambler", "b252e57d-7370-4c59-a898-fd381593cb33"),
      deadRole("754c7e75-d557-46f7-aaf9-60a39961ffd8", "Chihiro Fujisaki", "Ultimate Programmer", "a4ebdc0d-72f7-465a-b06e-53ee37746723", "Angel", 2, "", 1787242314407),
      deadRole("4d2d1d91-7671-4c6f-8e4f-16c05bf385ed", "Hifumi Yamada", "Ultimate Fanfic Creator", "10b0450b-a6d3-40ee-8c40-c67bafeb3eb5", "MD", 3, "pretrial", 1788474843264),
      deadRole("15c3c41c-1064-4156-b596-10e8bff46d63", "Junko Enoshima", "Ultimate Fashionista", "a4ebdc0d-72f7-465a-b06e-53ee37746723", "Angel", 1, "", 1787242260911),
      deadRole("b2d7fde3-4301-4417-9f07-7da48240dc1c", "Kiyotaka Ishimaru", "Ultimate Moral Compass", "b252e57d-7370-4c59-a898-fd381593cb33", "Nicher", 3, "pretrial", 1788475272594),
      role("292ea90b-ffb0-4fce-aac3-1158dda9f9f5", "Kyoko Kirigiri", "Ultimate ???", "d048a413-62b3-4802-9f15-af80fea2885a"),
      deadRole("aad28266-f086-4d46-9f9d-64f66d700540", "Leon Kuwata", "Ultimate Baseball Star", "b252e57d-7370-4c59-a898-fd381593cb33", "Nicher", 1, "pretrial", 1787242428776),
      deadRole("c02a3b84-d231-461f-b678-e7a50a2b12f7", "Mondo Owada", "Ultimate Biker Gang Leader", "d048a413-62b3-4802-9f15-af80fea2885a", "Reika", 2, "", 1787263999672),
      role("1480a75b-c902-47c1-84ac-2f53eb417029", "Sakura Ogami", "Ultimate Martial Artist", null),
      deadRole("ffaef254-bccf-4685-ad86-19a33dd1d59a", "Sayaka Maizono", "Ultimate Pop Sensation", "a4ebdc0d-72f7-465a-b06e-53ee37746723", "Angel", 1, "", 1787242407228),
      role("868249a6-801c-4a77-8f52-6034a46d02b5", "Toko Fukawa", "Ultimate Writing Prodigy", null),
      role("a5ed7e1b-f41a-4c07-8d03-a775d866eff9", "Yasuhiro Hagakure", "Ultimate Clairvoyant", "10b0450b-a6d3-40ee-8c40-c67bafeb3eb5"),
      role("577d949f-8348-4d1b-b859-e090da4a9fe2", "Narrator", "Narrator", "10b0450b-a6d3-40ee-8c40-c67bafeb3eb5"),
      role("c4ffbe84-eebb-46d7-a42a-fd6302e1c70e", "Genocide Jill", "Ultimate Murderous Fiend", null),
      role("06933870-aef1-4f19-bcb8-6bbcee51f846", "Alter Ego", "Ultimate AI?", null)
    ],
    results: {
      "1": { victim: "aad28266-f086-4d46-9f9d-64f66d700540", blackened: "", victimCorrectActorIds: [], blackenedCorrectActorIds: [] },
      "2": { victim: "", blackened: "", victimCorrectActorIds: [], blackenedCorrectActorIds: [] },
      "3": { victim: "4d2d1d91-7671-4c6f-8e4f-16c05bf385ed", blackened: "", victimCorrectActorIds: ["10b0450b-a6d3-40ee-8c40-c67bafeb3eb5"], blackenedCorrectActorIds: [] }
    },
    predictions: {},
    population: {
      "0": { alive: 15, dead: 0, unknown: 0 },
      "1": { alive: 12, dead: 3, unknown: 0 },
      "2": { alive: 10, dead: 5, unknown: 1 },
      "3": { alive: 7, dead: 8, unknown: 1 },
      "4": { alive: 0, dead: 0, unknown: 0 },
      "5": { alive: 0, dead: 0, unknown: 0 },
      "6": { alive: 0, dead: 0, unknown: 0 }
    }
  };

  function role(id, name, title, ownerId) {
    return { id: id, name: name, title: title, image: "", ownerId: ownerId, dead: false, revealed: true, hiddenSpoiler: false, deathRecord: null };
  }

  function deadRole(id, name, title, lastActorId, lastActorName, chapter, phase, at) {
    var item = role(id, name, title, null);
    item.dead = true;
    item.deathRecord = { lastActorId: lastActorId, lastActorName: lastActorName, chapter: chapter, phase: phase, at: at };
    return item;
  }
})();
