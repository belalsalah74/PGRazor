// Experimental, supported ARM64 build only. No native work on load.

//

// Automatic dismissal of the post-catch summary and matched stats/details.

// Summary follows a confirmed CatchSuccess, by invoking the normal

// inherited GuiController.Dismiss() exactly once on a later proven Unity-thread

// tick. It drives the game's own close path; it never forges success, never

// touches the capture result, never sets currentState, never completes any

// promise, and never calls lifecycle cleanup handlers directly. A confirmed
// manual catch can bypass details presentation and use the supplied dismissal
// delegate after normal summary dismissal and the existing transfer checks.
// The fallback details path uses OnDismissOrContinueClicked after buji

// and Initialize return and opening completes. New-species/new-form cutscenes

// and XP/toast presentation remain under the game's normal control flow.

//

// Gating follows build/feature-research/SUMMARY-CLOSE-CONTROLS.txt: the matching

// SummaryState.Initialize(CatchPokemonOutProto), SummaryGui.SetScores and

// SummaryGui.HandleOpenComplete must all have RETURNED for the same GUI instance;

// base currentState (+0x70) must read the normal-open scalar 2 (the value

// DismissWithPromise accepts, per the static disassembly, not guessed from the

// enum); OnDismissed (+0x2a8) must be non-null (installed by the matching state);

// the response must be CatchSuccess with a present captured id; and no

// opener/initialization hook may be on the stack. Queued work is cancelled on

// OFF, lease expiry, stop, user/natural dismissal, identity mismatch or timeout.

//

// Nested native invocation can suppress our own Interceptor callbacks (see

// SUMMARY-CLOSE-NESTED-HOOKS.txt), so the invoke never depends on the Dismiss

// hook firing: it verifies the state transition directly and keeps every owned

// GC handle until released on the Unity thread. Default OFF; a 2500ms lease.

(function(root){

'use strict';


const VGP={camera:'UnityEngine.Camera',screen:'UnityEngine.Screen',wild:'Niantic.Holoholo.Map.WildMapPokemon',pokemon:'Niantic.Holoholo.Map.MapPokemon',stop:'Niantic.Holoholo.Pokestop.MapPokestop',place:'Niantic.Holoholo.Map.IMapPlace',player:'Niantic.Holoholo.PlayerService',playerContract:'Niantic.Holoholo.IPlayerService',bagContract:'Niantic.Holoholo.IPokemonBag',itemContract:'Niantic.Holoholo.IItemBag',rpc:'Niantic.Holoholo.Rpc.RpcHandler',request:'Holoholo.Rpc.FortSearchProto',fort:'Holoholo.Rpc.PokemonFortProto',method:'Holoholo.Rpc.Method',type:'System.Type'};

const LIMITS=Object.freeze({nameBytes:256,assemblies:256,retries:240,leaseMs:2500,pollMs:250,queue:128,timeoutMs:8000,hitsPerSecond:1000,maxRecords:4});

const GUI='Niantic.Holoholo.NUI.GuiController',SGUI='Niantic.Holoholo.Encounter.EncounterSummaryGuiController',SSTATE='Niantic.Holoholo.Encounter.EncounterSummaryState';

const DGUI='Niantic.Holoholo.UI.Pokemon.PokemonInfoGuiController',DATA='Niantic.Holoholo.UI.Pokemon.PokemonInfoData',VIEW='Niantic.Holoholo.Encounter.EncounterViewPokemonState',PK='Holoholo.Rpc.PokemonProto',INT='System.Int32',DELEGATE='System.Delegate',ACTION='System.Action';

const SPINSTATE='Niantic.Holoholo.Pokestop.PokestopSpinnerInteractionState',SPINGUI='Niantic.Holoholo.Pokestop.PokestopSpinnerInteractionGuiController',GESTURE='Niantic.Holoholo.GameInput.ItemSpinnerGestureHandler',SPINNER='Niantic.Holoholo.Map.PoiItemSpinner',SPINBASE='Niantic.Holoholo.Map.BasePoiSpinner',SPINRESULT='Holoholo.Rpc.FortSearchOutProto';

const APPROACH='Niantic.Holoholo.Pokestop.PokestopApproachState',RESOLVE='Niantic.Holoholo.Pokestop.PokestopResolveState',SPLINE='Niantic.Holoholo.CameraRig.SplineCameraController';

const IBAG='Niantic.Holoholo.Internal.ItemBagImpl',ISERVICE='Niantic.Holoholo.UI.Items.ItemInventoryService',IRESPONSE='Holoholo.Rpc.RecycleItemOutProto';

const ITEMCODE={"GetItemCount":[167765300,"fe0f1df8f65701a9f44f02a9748602b0f30300aa888a4839"],"RecycleItem":[167800040,"ffc302d1fd7b05a9fc6f06a9fa6707a9f85f08a9f65709a9"],"get_ExpiringItemsCopy":[163086408,"005c40f9c0035fd6ff8302d1fd7b04a9fc6f05a9fa6706a9"],"cjpx":[163086416,"ff8302d1fd7b04a9fc6f05a9fa6706a9f85f07a9f65708a9"],"ListSortedPlayerInventory":[163101296,"fe0f1bf8fa6701a9f85f02a9f65703a9f44f04a9f4a902d0"],"zid":[167826240,"ff0302d1fe5f05a9f65706a9f44f07a9f58502d0f30301aa"],"zie":[167827064,"fe0f1df8f65701a9f44f02a9f58502d0f30301aaf40300aa"]};

const ROCKET='Niantic.Holoholo.Combat.Contexts.InvasionCombatState',RUI='Niantic.Holoholo.Combat.UI.CombatUI',RDIR='Niantic.Holoholo.Combat.CombatDirectorV2',RCHARGE='Niantic.Holoholo.Combat.UI.CombatChargeAttackDisplay',RSHIELD='Niantic.Holoholo.Combat.InputChallenge.ShieldModalGuiController';

const VGP_NAMEPLATE='Niantic.Holoholo.Encounter.EncounterNameplate';
const BERRY='Niantic.Holoholo.Encounter.EncounterInteractionState',BERRYGUI='Niantic.Holoholo.Encounter.EncounterItemUseGuiController',FEEDGUI='Niantic.Holoholo.UI.Items.FeedItemGuiBase';

const BERRY_CODE={"get_CanUseBerry":[181361316,"081842b91f010071e0179f1ac0035fd600b04a39c0035fd6"],"get_IsInPhotoMode":[181361364,"fe57bea9f44f01a9d41e02d0f30300aa88d2593908010037"],"get_PokeballInPlay":[181361500,"fe57bea9f44f01a9d41e02d0f30300aa88065c3908010037"],"SelectBerry":[181379392,"fe0f1bf8fa6701a9f85f02a9f65703a9f44f04a9b41e02b0"],"EnterState":[181381832,"fe0f1cf8f85f01a9f65702a9f44f03a9b41e02b0f30300aa"],"ExitState":[181396348,"fe67bca9f85f01a9f65702a9f44f03a9941e02b0f30300aa"],"ClickConfirm":[162887612,"fe67bca9f85f01a9f65702a9f44f03a994ab02d0f30300aa"]};

const BATTLE_TYPES={"31514":"Niantic.Holoholo.VNext.RaidBattleVNextState","31244":"Niantic.Holoholo.Bread.BreadBattleState","10591":"Niantic.Holoholo.Gym.GymBattleState","31499":"Niantic.Holoholo.VNext.RaidBattleGestureHandler","31285":"Niantic.Holoholo.Bread.BreadBattleGestureHandler","9182":"Niantic.Holoholo.Battle.BattleGestureHandler","9308":"Niantic.Holoholo.Battle.ChargeAttackDisplay","31280":"Niantic.Holoholo.Bread.BreadAbilityWidget","9284":"Niantic.Holoholo.Battle.EnemyAlertIndicator","31623":"Niantic.Holoholo.VNext.EnemyAlertIndicatorVNext","31263":"Niantic.Holoholo.Bread.TelegraphIndicator","31569":"Niantic.Holoholo.VNext.BattleDirector","44226":"Niantic.Holoholo.VNext.BattleState","9322":"Niantic.Holoholo.Battle.SwapUI","31639":"Niantic.Holoholo.VNext.SwapUIVNext","31337":"Niantic.Holoholo.Bread.BreadSwapUI"};

const BATTLE_CODE={"9182:OnEnable":[183456908,"ff8301d1fe1300f9f85f03a9f65704a9f44f05a9d40e02f0"],"9182:OnDisable":[183458624,"fe0f1df8f65701a9f44f02a9d40e02f0f30300aa884e4439"],"9182:SetChargeAttackButtons":[183459176,"682002b0010c0bf808c144b9a8010034fe0f1ff8098052d3"],"9182:bwqr":[183459244,"ff0303d1ea2300fde923056dfd7b06a9fc6f07a9fa6708a9"],"9308:get_IsCharged":[183731356,"00e04639c0035fd601e00639c0035fd600e44639c0035fd6"],"9308:Init":[183731452,"ff8302d1ea1300fde923036dfd7b04a9fc6f05a9fa6706a9"],"9308:ChargeAttackButtonTapped":[183752404,"e80f19fcfd7b01a9fc6f02a9fa6703a9f85f04a9f65705a9"],"10591:EnterState":[156310396,"fd7bbaa9fc6f01a9fa6702a9f85f03a9f65704a9f44f05a9"],"10591:ExitState":[156312036,"fd7bbaa9fc6f01a9fa6702a9f85f03a9f65704a9f44f05a9"],"31244:EnterState":[153265176,"ff0302d1fd7b02a9fc6f03a9fa6704a9f85f05a9f65706a9"],"31244:ExitState":[153275788,"fe57bea9f44f01a9d4f402d0f30300aa88ae6a39a8010037"],"31280:Cleanup":[153336952,"fe0f1cf8f85f01a9f65702a9f44f03a954f402f0f30300aa"],"31280:Refresh":[153342188,"080040f9023941f9033541f960001fd6e10000b4081841b9"],"31285:cqjz":[153354200,"fe4fbfa9f30300aa1e6a009468fa40b908010034080d0051"],"31351:SetChargeAttackButtons":[153460496,"480503b0018c0ef808c144b9a8010034fe0f1ff8098052d3"],"31351:OnEnable":[153460988,"fe0f1cf8f85f01a9f65702a9f44f03a974f30290f30300aa"],"31351:OnDisable":[153462380,"fe0f1df8f65701a9f44f02a974f30290f30300aa88626e39"],"31499:cqjz":[153796784,"fe4fbfa9f30300aae8b9fe97e00313aae1031faafe4fc1a8"],"31514:EnterState":[153812088,"fe0f1bf8fa6701a9f85f02a9f65703a9f44f04a9b6f002f0"],"31514:ExitState":[153828484,"fe57bea9f44f01a994f002f0f30300aa883a7539a8010037"],"31351:cqpd":[153469604,"fe5fbda9f65701a9f44f02a955f302d0f303012af40300aa"],"9182:bwqu":[183462720,"e80f1dfcfe0700f9f65701a9f44f02a9d50e02d0f40301aa"],"31623:crlu":[154115704,"fe57bea9f44f01a974ee02b0f30300aa888a7a3948020037"],"31263:cqim":[153315360,"e80f1efcfe4f01a9034040bd0840201e01e4002f02102e1e"],"9283:MoveNext":[183692812,"ff8301d1e923026dfe1b00f9f65704a9f44f05a9140d02d0"],"31569:get_CurrentState":[153929856,"008840f9c0035fd600604439c0035fd601600439c0035fd6"],"31351:cqpa":[153467264,"fe67bca9f85f01a9f65702a9f44f03a953f302f0f40300aa"],"31351:OnDestroy":[153460632,"fe5fbda9f65701a9f44f02a974f302b0f30300aa885e6e39"],"9322:get_IsOpen":[183768912,"fe0f1df8f65701a9f44f02a9740c02f0f30300aa88fe4a390801003760e201b0"],"9322:OnDestroy":[183790408,"fe5fbda9f65701a9f44f02a9540c02d0f30300aa88524a39e8020037a0e001d0"],"9322:Open":[183790892,"fe0f1cf8f85f01a9f65702a9f44f03a9540c02d0f30300aa88564a3908010037"],"9322:Dismiss":[183769212,"fe0f1df8f65701a9f44f02a9740c02f0f30300aa88064b390801003760e201b0"],"31337:get_IsShowing":[153438068,"00444239c0035fd601440239c0035fd6ff0301d1fe5702a9f44f03a994f302d0"],"31337:Cleanup":[153438084,"ff0301d1fe5702a9f44f03a994f302d0f30300aa88e66d398803003760cb02b0"],"31337:OpenSwapMenu":[153439844,"fe0f1cf8f85f01a9f65702a9f44f03a994f302d0f30300aa88ee6d3908010037"],"31337:HideSwapMenu":[153440928,"fe5fbda9f65701a9f44f02a994f302b0f30300aa88fa6d390801003720c902f0"],"31337:Dismiss":[153441924,"07ffff17fe0f1df8f65701a9f44f02a994f302b0f30300aa88fe6d3948020037"],"31639:get_IsOpen":[154129928,"fe0f1df8f65701a9f44f02a954ee02b0f30300aa88027c390801003780c402b0"],"31639:OnDestroy":[154167704,"fe0f1cf8f85f01a9f65702a9f44f03a914ee0290f30300aa886e7b39a8010037"],"31639:Open":[154168180,"fe67bca9f85f01a9f65702a9f44f03a914ee0290f30300aa88067c3908060037"],"31639:Dismiss":[154130228,"fe0f1df8f65701a9f44f02a954ee02b0f30300aa880e7c390801003780c402b0"]};

const RMINI='Niantic.Holoholo.Combat.InputChallenge.ParticleTapInputChallenge',RMINIBASE='Niantic.Holoholo.Combat.InputChallenge.CombatInputChallenge';

const RMCode={"UpdateMinigame":[179051108,"ffc301d1ea0b00fde923026dfe6703a9f85f04a9f65705a9"],"ExitGame":[179057384,"ff4302d1eb2b026de923036dfe2300f9fa6705a9f85f06a9"],"Hide":[179046660,"fe0f1cf8f85f01a9f65702a9f44f03a9743002d0f30300aa"],"OnDestroy":[179047376,"fe5fbda9f65701a9f44f02a9743002d0f30300aa88c26739"]};

const RVUI='Niantic.Holoholo.Combat.UI.CombatVNextGuiController',RVGEST='Niantic.Holoholo.VNext.CombatVNextGestureHandler',RVBASE='Niantic.Holoholo.VNext.BattleGestureHandlerVNext',RVCHARGE='Niantic.Holoholo.VNext.ChargeAttackDisplayVNext';

const RVCode={"31113:UpdateUiWidgets":[152955364,"e80f1bfcfe0700f9fa6701a9f85f02a9f65703a9f44f04a9"],"31113:HandleDismiss":[152947860,"fe57bea9f44f01a954f702d0f30300aa88e2653908010037"],"31113:get_IsInputBlocked":[152950684,"fe5fbda9f65701a9f44f02a954f702b0f30300aa88ee6539"],"31443:cqul":[153694288,"ff4301d1fe0b00f9f85f02a9f65703a9f44f04a994f102f0"],"31616:ObserveBattleState":[154064256,"fe0f1af8fc6f01a9fa6702a9f85f03a9f65704a9f44f05a9"],"31616:ChargeAttackButtonTapped":[154083804,"e80f1afcfe0700f9fc6f01a9fa6702a9f85f03a9f65704a9"],"31616:get_IsCharged":[154057736,"00b04839c0035fd601b00839c0035fd600b44839c0035fd6"],"31616:get_IsVisible":[154057800,"fe0f1df8f65701a9f44f02a908bc483928080034e1031faa"]};

const ROCKETCODE={"7100:UpdateActionsUI":[179283360, "fe5fbda9f65701a9f44f02a915cc40f9750d00b4962f02d0"],"7137:EnterState":[179334704,"fe0f1cf8f85f01a9f65702a9f44f03a9562e0290f40302aa"],"7137:ExitState":[179351272,"fe0f1df8f65701a9f44f02a9342e0290f30300aa88027139"],"7100:Initialize":[179268616,"ef3bb86ded33016deb2b026de923036dfe6704a9f85f05a9"],"7100:HandleDismiss":[179270220,"fe0f1cf8f85f01a9f65702a9f44f03a9b42e02f0f30300aa"],"7100:bpro":[179262080,"fe57bea9f44f01a9d42e02b0f30300aa886a6d3908010037"],"6533:get_IsInActiveState":[178007452,"fe57bea9f44f01a974380290f30300aa88ee5139e8000036"],"6533:TryFastAttack":[178019108,"fe0f1df8f65701a9f44f02a9543802b0f30300aa88065239"],"7064:OnTap":[179204872,"ff8301d1fe6702a9f85f03a9f65704a9f44f05a9342f02f0"],"7064:get_IsVisible":[179194140,"ff0301d1fe0b00f9f65702a9f44f03a9e1031faaf30300aa"],"6971:ShowShieldPrompt":[179031204,"fe67bca9f85f01a9f65702a9f44f03a9953002d0f303012a"],"6971:ShieldUiClicked":[179036768,"ffc301d1fe1300f9fa6703a9f85f04a9f65705a9f44f06a9"],"6971:HandleDismiss":[179036540,"fe57bea9f44f01a993300290f40300aa689a673908010037"]};

const RELEASE='Holoholo.Rpc.ReleasePokemonOutProto';

const BAG='Niantic.Holoholo.Internal.PokemonBagImpl',DISPLAY='Holoholo.Rpc.PokemonDisplayProto';

const RESP='Holoholo.Rpc.CatchPokemonOutProto',ITEM='Holoholo.Rpc.Item',OBJ='UnityEngine.Object',SYNC='UnityEngine.UnitySynchronizationContext',BOOL='System.Boolean',ENUM=RESP+'.Types.Status';

// Normal-open close state. GuiController.Dismiss no-ops at 0 or 3; DismissWithPromise

// accepts 2 and writes 3 before HandleDismiss (SUMMARY-CLOSE-CONTROLS.txt:62-65).

const STATE_OPEN=2;

// Method identity: debug_get_method_info address must equal module.base+rva, then a

// instruction prefix extracted from the hash-verified clean library in

// summary-close-contract/instruction-prefixes.json. op_Implicit uses the verified

// quick-ball.js fingerprint. ExecuteTasks is resolved by its exact signature.

const CODE={

 detailsPresent:[0xada4ac8,'ff0302d1fd7b02a9fc6f03a9fa6704a9f85f05a9f65706a9f44f07a9571902f0'],

 detailsExit:[0xada5814,'fe0f1ef8f44f01a9086c40f9f30300aaa80000b4090d40f9002140f9011540f9'],

 detailsOpen:[0x9a2a4b0,'fe5fbda9f65701a9f44f02a9f4b402f0f30300aa88f6503928020036f58a02f0'],

 detailsInit:[0x9a2d004,'ff8301d1fe6702a9f85f03a9f65704a9f44f05a9f5b40290f30301aaf40300aa'],

 detailsClick:[0x9a3702c,'fe57bea9f44f01a994b402d0f30300aa88a65139e800003694b402d088d65039'],



 exitState:[0xad3724c,'fe67bca9f85f01a9f65702a9f44f03a9d41c0290f30300aa886e5f3928040037'],

 dismiss:[0xa375344,'fe0f1df8f65701a9f44f02a9b46a02f0f30300aa88ea513968020036b46a02f0'],

 handleOpenComplete:[0xad2c7fc,'fe67bca9f85f01a9f65702a9f44f03a9141d02f0f30300aa8836613908010037'],

 setScores:[0xad2eb84,'ff4305d1ef3b0b6ded330c6deb2b0d6de9230e6dfd7b0fa9fc6f10a9fa6711a9'],

 initialize:[0xad37690,'fe6fbba9fa6701a9f85f02a9f65703a9f44f04a9d51c0290f40301aaf30300aa'],

 op_Implicit:[0xda6bba0,'fe0f1df8f65701a9f44f02a9f4b30090f30300aa882e673988020036f48800d0']};

const GIFT_OPEN_SEQUENCE='Niantic.Holoholo.Social.Gifting.UI.OpenGiftGuiController.ddh';

const GIFT_OPEN_SEQUENCE_CODE=[177597004, "ff0302d1e81300fdfe1700f9fc6f03a9fa6704a9f85f05a9"];

const GIFT_TYPES={"5916": "Niantic.Holoholo.Social.UI.FriendProfileGuiController", "5936": "Niantic.Holoholo.Social.UI.FriendProfileInfoPanel", "6240": "Niantic.Holoholo.Social.Gifting.UI.OpenGiftGuiController", "6258": "Niantic.Holoholo.Social.Gifting.UI.SendGiftGuiController", "6268": "Niantic.Holoholo.Social.Gifting.UI.ViewGiftsGuiController", "6211": "Niantic.Holoholo.Social.Gifting.UI.GiftItemView2Widget", "6176": "Niantic.Holoholo.Social.Gifting.UI.StickerSelectionItemWidget", "6195": "Niantic.Holoholo.Social.Gifting.UI.StickerSheetGuiController", "6164": "Niantic.Holoholo.Social.Gifting.StickerService"};

const GIFT_CODE={"5916.get_ActionButtonsDisabled": [176789820, "00c04639c0035fd601c00639c0035fd6fe57bea9f44f01a9"], "5916.get_CurrentlyOpenFriendProfileInfoPanel": [176789836, "fe57bea9f44f01a9b4410290f30300aa88f6783908010037"], "5916.HandleOpenComplete": [176791260, "fe5fbda9f65701a9f44f02a9b4410290f30300aa88067939"], "5916.HandleDismiss": [176794104, "fd7bbaa9fc6f01a9fa6702a9f85f03a9f65704a9f44f05a9"], "5936.SetFriendInfo": [176826240, "fe0f1bf8fa6701a9f85f02a9f65703a9f44f04a9554102f0"], "5936.CheckOnGift": [176809692, "ff0302d1fe6704a9f85f05a9f65706a9f44f07a9744102f0"], "5936.OnGiftClick": [176871800, "fe5fbda9f65701a9f44f02a914410290f30300aa88c67939"], "6164.AnyStickers": [177422984, "fe57bea9f44f01a9d43c02d0f30300aa887a4439e8020037"], "6164.StickerCountExcludingReserved": [177433316, "fe0f1df8f65701a9f44f02a9d53c0290f40301aaf30300aa"], "6240.HandleOpenComplete": [177580256, "c0035fd6fe57bea9f44f01a9b43b0290f30300aa88ca4739"], "6240.HandleDismiss": [177580260, "fe57bea9f44f01a9b43b0290f30300aa88ca473908010037"], "6240.OnOpenClick": [177580924, "08a44a394800003402000014cc000014ff4302d1fe6705a9"], "6258.HandleOpenComplete": [177634752, "e80f1dfcfe0700f9f65701a9f44f02a9343b02f0f30300aa"], "6258.HandleDismiss": [177635080, "1fd40b39c0035fd6fe57bea9f44f01a9343b02f0f30300aa"], "6258.OnSendClick": [177635852, "fe0f1df8f65701a9f44f02a9343b02d0f30300aa887e4839"], "6258.OnStickersClick": [177641572, "fe0f1cf8f85f01a9f65702a9f44f03a9343b02b0f30300aa"], "6176.Click": [177447172, "fe57bea9f44f01a9b33c0290f40300aa681a453908010037"], "6176.Reinitialize": [177447400, "e80f1cfcfe0700f9f85f01a9f65702a9f44f03a9b43c0290"], "6195.HandleOpenComplete": [177462784, "fe0f1cf8f85f01a9f65702a9f44f03a9943c02b0f30300aa"], "6195.HandleDismiss": [177463472, "fe0f1df8f65701a9f44f02a9943c0290f30300aa885a4539"], "6211.UpdateData": [177537608, "fe5fbda9f65701a9f44f02a9f63b02d0f30302aaf503012a"], "6211.GiftBox": [177538336, "3f04007128010054086840f9e80000b43f00007109038052"], "6211.OnClick": [177538548, "097040f9090100b4e80300aa202140f9231540f9240d40f9"], "6268.Initialize": [177657828, "fe6fbba9fa6701a9f85f02a9f65703a9f44f04a9153b02b0"], "6268.HandleOpenComplete": [177663572, "c0035fd6fe57bea9f44f01a9143b0290f30300aa88d24839"], "6268.HandleDismiss": [177663576, "fe57bea9f44f01a9143b0290f30300aa88d2483908010037"]};

Object.assign(GIFT_CODE,{"6268.ExitGui": [177664272, "fe0f1df8f65701a9f44f02a9f43a02f0f30300aa88da4839"], "6258.bnah": [177646492, "fe0f1bf8fa6701a9f85f02a9f65703a9f44f04a9353b0290"]});

Object.assign(GIFT_CODE,{"6164.GetStickerInventory": [177426172, "fe5fbda9f65701a9f44f02a9d53c02d0f303012af40300aa"], "6258.bmzx": [177632528, "fe0f1af8fc6f01a9fa6702a9f85f03a9f65704a9f44f05a9"]});

Object.assign(GIFT_TYPES,{6149:'Niantic.Holoholo.Social.Gifting.GiftingRpcService',6154:'Niantic.Holoholo.Social.Gifting.GiftingService'});

Object.assign(GIFT_CODE,{"6149.SendGift": [177377404, "fe0f1af8fc6f01a9fa6702a9f85f03a9f65704a9f44f05a9"], "6154.get_SendableGiftsInInventory": [177385668, "fe0f1df8f65701a9f44f02a9143d02f0f30300aa883a4639"], "6164.ReserveStickers": [177430692, "ff4302d1fe6705a9f85f06a9f65707a9f44f08a9d53c0290"], "6164.ReturnReservedStickers": [177431808, "ff0302d1fe2300f9f85f05a9f65706a9f44f07a9d63c0290"], "6147.bmnz": [177383752, "fe0f1cf8f85f01a9f65702a9f44f03a9343d0290f60301aa"], "6147.bmoa": [177384848, "fe57bea9f44f01a9343d0290f30300aa88e2433908010037"]});

const BUDDY_TYPES={"7757": "Niantic.Holoholo.Buddy.BuddyObservedDataExt", "7768": "Niantic.Holoholo.Buddy.BuddyRpcService", "7769": "Niantic.Holoholo.Buddy.BuddyStatsService", "8109": "Niantic.Holoholo.Buddy.BuddyPokemonService"};

const BUDDY_CODE={"7757.OnMapRemainingSec": [180184056, "fe57bea9f44f01a9d42702b0f30300aa8806413908010037"], "7757.PreMapFullnessPercentage": [180184200, "00e4002f800000b4082040f9480000b4001940bdc0035fd6"], "7757.InFullnessCooldown": [180184224, "fe57bea9f44f01a9d42702b0f30300aa880a413908010037"], "7768.Feed": [180188396, "fe0f1cf8f85f01a9f65702a9f44f03a9d5270290f303022a"], "8109.get_BuddyPokemon": [180846228, "00b840f9c0035fd6483402f001b800f908c144b9c8010034"], "8109.get_HasBuddy": [180846316, "00e04539c0035fd601e00539c0035fd6fe57bea9f44f01a9"], "7763.brhd": [180191752, "fe0f1df8f65701a9f44f02a9b52702f0f30301aaf40300aa"], "7769.get_BuddyStats": [180193380, "003840f9c0035fd6483902d0010c07f808c144b9a8010034"]};

const BERRY_THROW_CODE={"btdx": [181423396, "fe67bca9f85f01a9f65702a9f44f03a9551e02f0f403012a"], "btdy": [181424920, "e80f1cfcfe0700f9f85f01a9f65702a9f44f03a9551e02d0"], "btdz": [181425904, "fe57bea9f44f01a9080840f9280500b4141e02f013fd40f9"], "get_HoldingBreadBall": [181757284, "00004939c0035fd601000939c0035fd6ff0301d1e80b00fd"], "get_BallType": [181765900, "007443b9c0035fd6017403b9c0035fd6e1031faaae05b414"], "submit": [181795804, "fe5fbda9f65701a9f44f02a9961b0290f50302aaf40301aa"], "peek": [181764464, "fe0f1df8f65701a9f44f02a9b41b02f0f30300aa88866239"]};

const SPEC={field_set_value_object:['void',['pointer','pointer','pointer']],object_new:['pointer',['pointer']],field_set_value:['void',['pointer','pointer','pointer']],object_get_virtual_method:['pointer',['pointer','pointer']],class_get_methods:['pointer',['pointer','pointer']],string_length:['int',['pointer']],string_chars:['pointer',['pointer']],class_get_nested_types:['pointer',['pointer','pointer']],class_get_declaring_type:['pointer',['pointer']],domain_get:['pointer',[]],domain_get_assemblies:['pointer',['pointer','pointer']],assembly_get_image:['pointer',['pointer']],class_from_name:['pointer',['pointer','pointer','pointer']],class_get_type:['pointer',['pointer']],class_get_field_from_name:['pointer',['pointer','pointer']],field_get_type:['pointer',['pointer']],field_get_flags:['int',['pointer']],field_get_parent:['pointer',['pointer']],field_get_offset:['size_t',['pointer']],class_get_method_from_name:['pointer',['pointer','pointer','int']],method_get_class:['pointer',['pointer']],method_get_name:['pointer',['pointer']],method_get_flags:['uint32',['pointer','pointer']],method_get_param_count:['uint32',['pointer']],method_get_param:['pointer',['pointer','uint32']],method_get_return_type:['pointer',['pointer']],method_is_generic:['bool',['pointer']],method_is_inflated:['bool',['pointer']],class_from_type:['pointer',['pointer']],class_is_enum:['bool',['pointer']],class_enum_basetype:['pointer',['pointer']],class_is_valuetype:['bool',['pointer']],class_value_size:['int',['pointer','pointer']],field_static_get_value:['void',['pointer','pointer']],type_get_name:['pointer',['pointer']],free:['void',['pointer']],thread_current:['pointer',[]],thread_attach:['pointer',['pointer']],thread_detach:['void',['pointer']],object_get_class:['pointer',['pointer']],field_get_value:['void',['pointer','pointer','pointer']],runtime_invoke:['pointer',['pointer','pointer','pointer','pointer']],object_unbox:['pointer',['pointer']],gchandle_new:['pointer',['pointer','bool']],gchandle_get_target:['pointer',['pointer']],gchandle_free:['void',['pointer']]};

// Unity-thread identity/tick: match il2cpp_runtime_invoke whose first argument is the

// resolved UnitySynchronizationContext.ExecuteTasks method. Dismiss()/op_Implicit are

// invoked on that thread; a non-ExecuteTasks invoke is never treated as a tick.

const FILTER=`

#include <gum/guminterceptor.h>

#include <glib.h>

extern gpointer execute_method;

extern int enter_match(unsigned int tid);

extern void leave_match(unsigned int tid);

typedef struct {int accepted;} Match;

void on_enter(GumInvocationContext *ic){Match *m=GUM_IC_GET_INVOCATION_DATA(ic,Match);m->accepted=0;if(gum_invocation_context_get_nth_argument(ic,0)==execute_method)m->accepted=enter_match(gum_invocation_context_get_thread_id(ic));}

void on_leave(GumInvocationContext *ic){Match *m=GUM_IC_GET_INVOCATION_DATA(ic,Match);if(m->accepted)leave_match(gum_invocation_context_get_thread_id(ic));}

`;

const DEBUG=[0x90051008,0xf9474508,0xb4000148,0x90051009,0xf9474929,0xb40000e9,0xf940040a,0xeb0a011f,0x2a1f03e8,0x54000128,0xeb0a013f,0x540000e3,0xb40000a1,0xf9400408,0xb900083f,0xf900083f,0xf9000028,0x52800028,0x2a0803e0,0xd65f03c0];

let running=null;

// Keep native filter storage alive through any invocation already in flight.

const SPAWN='Niantic.Holoholo.Map.MapEntityService';

const retainedFilters=[];

function text(p){if(p.isNull())throw Error('null-name');let n=0;while(n<LIMITS.nameBytes&&p.add(n).readU8())n++;if(n===LIMITS.nameBytes)throw Error('name-limit');return n?p.readUtf8String(n):'';}

function bind(module){const api={};for(const[key,[result,args]]of Object.entries(SPEC)){const address=module.findExportByName('il2cpp_'+key);if(!address||address.isNull())throw Error('missing-export:'+key);// Managed calls must retain the game's native exception handling. Stealing a fault
// unwinds IL2CPP/ART frames and can produce a later JNI trampoline crash.
api[key]=new NativeFunction(address,result,args,key==='runtime_invoke'?{scheduling:'exclusive',exceptions:'propagate'}:{scheduling:'exclusive'});}return api;}

function typeName(api,type){const value=api.type_get_name(type);if(value.isNull())throw Error('null-type-name');try{return text(value);}finally{api.free(value);}}

function clock(){const libc=Process.findModuleByName('libc.so');const address=libc&&libc.findExportByName('clock_gettime');if(!address||address.isNull())throw Error('missing-monotonic-clock');const call=new NativeFunction(address,'int',['int','pointer'],{scheduling:'exclusive'});const out=Memory.alloc(16);let previous=-1;return()=>{if(call(7,out)!==0)throw Error('monotonic-clock-failed');const sec=out.readS64().toNumber(),ns=out.add(8).readS64().toNumber(),now=sec*1000+ns/1e6;if(!Number.isSafeInteger(sec)||sec<0||ns<0||ns>=1e9||!Number.isFinite(now)||now<previous)throw Error('invalid-monotonic-clock');previous=now;return now;};}

function checkBytes(address,hex){const bytes=new Uint8Array(address.readByteArray(hex.length/2));if(bytes.length!==hex.length/2)throw Error('short-instruction-read');for(let i=0;i<bytes.length;i++)if(bytes[i]!==parseInt(hex.slice(i*2,i*2+2),16))throw Error('unsupported-instructions');}

function executable(module,address,size){if(address.isNull()||!address.and(3).isNull()||address.compare(module.base)<0||address.add(size).compare(module.base.add(module.size))>0)throw Error('invalid-code-range');const range=Process.findRangeByAddress(address);if(!range||range.protection.indexOf('r')<0||!(range.protection.includes('x')||(typeof PGRazorGuestCode==='function'&&PGRazorGuestCode(module,address,size,range)))||address.add(size).compare(range.base.add(range.size))>0)throw Error('code-not-rx');}

function pointerHandleAbi(module){

 // Narrow fingerprint of the shipped 6000.3.22f1 ARM64 GC handle implementation,

 // identical to quick-ball.js. No GC handle function is called until it verifies.

 function readableCode(address,length){if(address.compare(module.base)<0||address.add(length).compare(module.base.add(module.size))>0)return false;const range=Process.findRangeByAddress(address);return range!==null&&range.protection.includes('r')&&(range.protection.includes('x')||(typeof PGRazorGuestCode==='function'&&PGRazorGuestCode(module,address,length,range)))&&address.add(length).compare(range.base.add(range.size))<=0;}

 function words(address,expected){return readableCode(address,expected.length*4)&&expected.every((word,i)=>address.add(i*4).readU32()===word);}

 function branch(address){if(!readableCode(address,4))return null;const word=address.readU32();if((word>>>26)!==5)return null;let immediate=word&0x03ffffff;if(immediate&0x02000000)immediate-=0x04000000;const target=address.add(immediate*4);return readableCode(target,4)?target:null;}

 try{

  const create=module.findExportByName('il2cpp_gchandle_new'),get=module.findExportByName('il2cpp_gchandle_get_target'),free=module.findExportByName('il2cpp_gchandle_free');

  if(!create||!get||!free||create.isNull()||get.isNull()||free.isNull())return false;

  if(!words(create,[0xaa0003e8,0x52800049,0x7200003f,0x1a890520,0xaa0803e1]))return false;

  const createBody=branch(create.add(20)),getBody=branch(get),freeBody=branch(free);

  return createBody!==null&&getBody!==null&&freeBody!==null&&words(createBody.add(0x384),[0x9a953120])&&words(getBody,[0xf81b0ffe])&&words(getBody.add(20),[0x9273c817,0x394082e8])&&words(freeBody,[0xf81b0ffe])&&words(freeBody.add(24),[0x9273c816,0x394082c8]);

 }catch(_){return false;}

}

function prepare(module,api,domain){

 let owned=null;

 try{

  if(api.thread_current().isNull()){owned=api.thread_attach(domain);if(owned.isNull())throw Error('metadata-thread-attach');}

  const count=Memory.alloc(8);count.writeU64(0);const list=api.domain_get_assemblies(domain,count),total=count.readU64();

  if(total.compare(0)===0)return null;if(total.compare(LIMITS.assemblies)>0||list.isNull())throw Error('assembly-limit');

  const required=[GUI,SGUI,SSTATE,RESP,OBJ,SYNC,BOOL],names=required.concat(['Niantic.Holoholo.NUI.GuiLayerService','Niantic.Holoholo.UI.Pokemon.PokemonInfoGuiService','Niantic.Zeppelin.GameStates.GameState'],Object.values(VGP),[VGP_NAMEPLATE,'System.Collections.IEnumerable','Niantic.Holoholo.Items.IncubatorService','Niantic.Holoholo.Items.IIncubatorService','Holoholo.Rpc.EggIncubatorProto','Niantic.Holoholo.Gym.MapGym','Holoholo.Rpc.RaidInfoProto','Holoholo.Rpc.GymDisplayProto','Holoholo.Rpc.PokemonProto','Holoholo.Rpc.CharacterSize','System.Collections.IEnumerator','System.IDisposable','Holoholo.Rpc.GiftBoxProto',GIFT_OPEN_SEQUENCE,'Holoholo.Rpc.OpenGiftOutProto','Holoholo.Rpc.SendGiftOutProto'],Object.values(BUDDY_TYPES),['Niantic.Holoholo.Buddy.IBuddyStatsService','Holoholo.Rpc.BuddyObservedData','Holoholo.Rpc.BuddyFeedingOutProto','Holoholo.Rpc.BuddyPokemonProto'],Object.values(GIFT_TYPES),['Niantic.Platform.Internal.Protos.FriendDetailsProto','Niantic.Platform.Internal.Protos.PlayerSummaryProto','Holoholo.Rpc.GiftBoxDetailsProto','Holoholo.Rpc.StickerProto'],['Niantic.Holoholo.Encounter.Pokeball','Niantic.Holoholo.Encounter.PokeballThrow',SPAWN,BERRY,BERRYGUI,FEEDGUI],Object.values(BATTLE_TYPES),['UnityEngine.Behaviour','UnityEngine.UI.Button',RMINI,RMINIBASE,'UnityEngine.Component','UnityEngine.Transform','UnityEngine.GameObject','UnityEngine.Vector3',RVUI,RVGEST,RVBASE,RVCHARGE,ROCKET,RUI,RDIR,RCHARGE,RSHIELD,'UnityEngine.UI.Selectable','Niantic.Holoholo.UI.Items.ItemInventoryGuiService','Niantic.Holoholo.UI.Items.IItemInventoryGuiService','Niantic.Holoholo.MapSceneContext','Zenject.SceneContext','Zenject.DiContainer','Niantic.Holoholo.UI.Items.IItemInventoryService',IBAG,ISERVICE,IRESPONSE,ITEM,APPROACH,RESOLVE,SPLINE,SPINSTATE,SPINGUI,GESTURE,SPINNER,SPINBASE,SPINRESULT,RELEASE,BAG,DISPLAY,DGUI,DATA,VIEW,PK,INT,DELEGATE,ACTION]),classes={};

  const inputs=names.map(n=>{const i=n.lastIndexOf('.');return[n,Memory.allocUtf8String(n.slice(0,i)),Memory.allocUtf8String(n.slice(i+1))];});

  for(let i=0;i<total.toNumber();i++){const image=api.assembly_get_image(list.add(i*8).readPointer());if(image.isNull())continue;

   for(const[name,ns,short]of inputs){const k=api.class_from_name(image,ns,short);if(k.isNull())continue;

    if(typeName(api,api.class_get_type(k))!==name||(classes[name]&&!classes[name].equals(k)))throw Error('class-mismatch:'+name);classes[name]=k;}}

  if(required.some(n=>!classes[n]))return null;

  const align=Memory.alloc(4),fieldMeta=[];

  function raw(owner,name,offset){const f=api.class_get_field_from_name(owner,Memory.allocUtf8String(name));

   if(f.isNull()||!api.field_get_parent(f).equals(owner)||(api.field_get_flags(f)&0x50)||Number(api.field_get_offset(f).toString())!==offset)throw Error('field-mismatch:'+name);return f;}

  // Reference fields (type encoding is not decoded in the contract, so the type

  // name is never asserted): confirm owner, offset, non-static and that the field

  // is a reference, not a value type. Runtime checks the actual object class.

  function refField(owner,name,offset){const f=raw(owner,name,offset);const klass=api.class_from_type(api.field_get_type(f));if(klass.isNull()||api.class_is_valuetype(klass))throw Error('field-not-reference:'+name);fieldMeta.push({name,owner:typeName(api,api.class_get_type(owner)),offset,kind:'ref'});return f;}

  // Int32-enum field (currentState): no fully-qualified enum name is invented; the

  // Int32 basetype, 4-byte size/alignment and value-type kind are verified instead.

  function enumI32Field(owner,name,offset){const f=raw(owner,name,offset);const klass=api.class_from_type(api.field_get_type(f));

   if(klass.isNull()||!api.class_is_enum(klass)||typeName(api,api.class_enum_basetype(klass))!=='System.Int32'||api.class_value_size(klass,align)!==4||align.readU32()!==4)throw Error('enum-abi:'+name);fieldMeta.push({name,owner:typeName(api,api.class_get_type(owner)),offset,kind:'enum-int32'});return f;}

  // Value-type field (captured id): size is read from metadata, never assumed; the

  // raw bytes are only checked for presence (non-zero), their meaning is not decoded.

  function valueField(owner,name,offset){const f=raw(owner,name,offset);const klass=api.class_from_type(api.field_get_type(f));if(klass.isNull()||!api.class_is_valuetype(klass))throw Error('field-not-value:'+name);const size=api.class_value_size(klass,align);if(size!==4&&size!==8)throw Error('value-size:'+name);fieldMeta.push({name,owner:typeName(api,api.class_get_type(owner)),offset,kind:'value',size});return{field:f,size};}

  const caughtId=valueField(classes[RESP],'CapturedPokemonId',0x20);

  if(caughtId.size!==8||typeName(api,api.field_get_type(caughtId.field))!=='System.UInt64')throw Error('captured-id-abi');

  const fields={currentState:enumI32Field(classes[GUI],'currentState',0x70),onDismissed:refField(classes[SGUI],'OnDismissed',0x2a8),

   dscx:refField(classes[SSTATE],'dscx',0xc0),dscy:refField(classes[SSTATE],'dscy',0xc8),caughtId:caughtId.field,status:enumI32Field(classes[RESP],'Status',0x10)};

  // Confirmed-success literal: CatchSuccess, read like quick-ball.js/quick-summary.js.

  const enumClass=api.class_from_type(api.field_get_type(fields.status)),literal=api.class_get_field_from_name(enumClass,Memory.allocUtf8String('CatchSuccess'));

  if(literal.isNull()||!api.field_get_parent(literal).equals(enumClass)||(api.field_get_flags(literal)&0x8050)!==0x8050||typeName(api,api.field_get_type(literal))!==ENUM)throw Error('success-literal');

  const out=Memory.alloc(4);api.field_static_get_value(literal,out);const success=out.readS32();

  if(!api.class_is_valuetype(classes[BOOL])||api.class_value_size(classes[BOOL],align)!==1||align.readU32()!==1)throw Error('boxed-abi:'+BOOL);

  if(!pointerHandleAbi(module))throw Error('gc-pointer-abi');

  const debugAddress=module.findExportByName('il2cpp_debug_get_method_info');if(!debugAddress)throw Error('debug-missing');executable(module,debugAddress,80);

  for(let i=0;i<DEBUG.length;i++)if(debugAddress.add(i*4).readU32()!==DEBUG[i])throw Error('debug-abi');

  const debug=new NativeFunction(debugAddress,'bool',['pointer','pointer'],{scheduling:'exclusive'}),addresses=new Set();

  function method(owner,name,ret,params,isStatic,code,inflated=false){const m=api.class_get_method_from_name(owner,Memory.allocUtf8String(name),params.length),impl=Memory.alloc(4);

   if(m.isNull()||!api.method_get_class(m).equals(owner)||text(api.method_get_name(m))!==name||Boolean(api.method_get_flags(m,impl)&16)!==isStatic||api.method_get_param_count(m)!==params.length||api.method_is_generic(m)||(!inflated&&api.method_is_inflated(m))||(typeof ret==='function'?!ret(typeName(api,api.method_get_return_type(m))):typeName(api,api.method_get_return_type(m))!==ret))throw Error('method-mismatch:'+name);

   for(let i=0;i<params.length;i++)if(typeof params[i]==='function'?!params[i](typeName(api,api.method_get_param(m,i))):typeName(api,api.method_get_param(m,i))!==params[i])throw Error('parameter-mismatch:'+name);

   let address=null;if(code){const info=Memory.alloc(24);info.writeByteArray(new Uint8Array(24));if(!debug(m,info))throw Error('debug-failed:'+name);address=info.readPointer();

    if(!address.equals(module.base.add(code[0]))||addresses.has(address.toString()))throw Error('method-address:'+name);addresses.add(address.toString());executable(module,address,code[1].length/2);checkBytes(address,code[1]);}

   return{method:m,address};}

  const methods={

   exitState:method(classes[SSTATE],'ExitState','System.Void',[],false,CODE.exitState),

   dismiss:method(classes[GUI],'Dismiss','System.Void',[],false,CODE.dismiss),

   initialize:method(classes[SSTATE],'Initialize','System.Void',[RESP],false,CODE.initialize),

   setScores:method(classes[SGUI],'SetScores','System.Void',[RESP,ITEM],false,CODE.setScores),

   handleOpenComplete:method(classes[SGUI],'HandleOpenComplete','System.Void',[],false,CODE.handleOpenComplete),

   alive:method(classes[OBJ],'op_Implicit','System.Boolean',[OBJ],true,CODE.op_Implicit),

   execute:method(classes[SYNC],'ExecuteTasks','System.Void',[],true,null)};

  // Fallback details ordering: ordinary Dismiss, then hide its canvas.
  // Keep the original transition arrays, cleanup callbacks and native call policy.
  let catchCanvas=null,catchCanvasError=null;
  try{catchCanvas=method(classes[GUI],'set_CanvasGroupVisible','System.Void',[BOOL],false,
   [0xa372cb8,'fe0f1cf8f85f01a9f65702a9f44f03a9d56a02d0f303012af40300aaa8ce5139']);}
  catch(e){catchCanvasError=String(e);}

  let catchDiscovery=null,catchDiscoveryError=null;
  try{const klass=classes['Niantic.Holoholo.NUI.GuiLayerService'];if(!klass)throw Error('gui-layer-class');
   catchDiscovery={klass,layer:refField(classes[GUI],'guiLayerService',0xa0),
    top:method(klass,'TopGui','Niantic.Holoholo.NUI.IGuiController',[],false,
     [0xa3797c0,'ff8302d1fd7b04a9fc6f05a9fa6706a9f85f07a9f65708a9f44f09a9936a02f0'])};
  }catch(e){catchDiscoveryError=String(e);}

  let catchScene=null,catchSceneError=null;
  try{const iter=Memory.alloc(8);iter.writePointer(ptr(0));let find=null;
   for(let i=0;i<256;i++){const q=api.class_get_methods(classes[OBJ],iter);if(q.isNull())break;
    if(text(api.method_get_name(q))==='FindObjectsOfType'&&!api.method_is_generic(q)&&api.method_get_param_count(q)===1&&typeName(api,api.method_get_param(q,0))==='System.Type'&&typeName(api,api.method_get_return_type(q))==='UnityEngine.Object[]'){find=q;break;}}
   if(!find)throw Error('catch-find-objects');
   const typeAddress=module.findExportByName('il2cpp_type_get_object'),lengthAddress=module.findExportByName('il2cpp_array_length');
   if(!typeAddress||!lengthAddress)throw Error('catch-scene-exports');
   catchScene={find,typeObject:new NativeFunction(typeAddress,'pointer',['pointer'],{scheduling:'exclusive'}),length:new NativeFunction(lengthAddress,'size_t',['pointer'],{scheduling:'exclusive'})};
  }catch(e){catchSceneError=String(e);}

  let details=null,detailsError=null;

  try{

   if([DGUI,DATA,VIEW,PK,INT,DELEGATE,ACTION].some(n=>!classes[n]))throw Error('details-classes-unavailable');

   function scalar(owner,name,offset,type,size){const f=raw(owner,name,offset),k=api.class_from_type(api.field_get_type(f));

    if(typeName(api,api.field_get_type(f))!==type||!api.class_is_valuetype(k)||api.class_value_size(k,align)!==size)throw Error('details-field:'+name);return f;}

   const df={delegateTarget:refField(classes[DELEGATE],'m_target',0x20),viewResponse:refField(classes[VIEW],'dsvw',0xe0),data:refField(classes[DGUI],'egbx',0x3a0),callback:refField(classes[DGUI],'egbu',0x388),

    onDismissed:refField(classes[DATA],'OnScreenDismissed',0x28),list:refField(classes[DATA],'PokemonList',0x10),

    index:scalar(classes[DATA],'StartingIndex',0x18,INT,4),post:scalar(classes[DATA],'IsPostEncounter',0x39,BOOL,1),id:scalar(classes[PK],'id_',0x20,'System.UInt64',8)};

   const listClass=api.class_from_type(api.field_get_type(df.list));

   const dm={

    present:method(classes[VIEW],'buji','System.Void',[PK,n=>/^System\.Collections\.Generic\.List(?:`1)?<Niantic\.Holoholo\.UI\.AwardBubbleData>$/.test(n),BOOL],false,CODE.detailsPresent),

    exit:method(classes[VIEW],'ExitState','System.Void',[],false,CODE.detailsExit),

    initialize:method(classes[DGUI],'Initialize','System.Void',[DATA],false,CODE.detailsInit),

    open:method(classes[DGUI],'HandleOpenComplete','System.Void',[],false,CODE.detailsOpen),

    click:method(classes[DGUI],'OnDismissOrContinueClicked','System.Void',[],false,CODE.detailsClick),

    count:method(listClass,'get_Count',INT,[],false,null,true),item:method(listClass,'get_Item',PK,[INT],false,null,true)};

   details={fields:df,methods:dm,listClass};

  }catch(e){detailsError=String(e);}

  let directPresentation=null,directPresentationError=null;
  try{if(!details)throw Error('direct-details-unavailable');
   const service='Niantic.Holoholo.UI.Pokemon.PokemonInfoGuiService';
   const active=raw(classes['Niantic.Zeppelin.GameStates.GameState'],'<IsActiveState>k__BackingField',0x50);
   if(typeName(api,api.field_get_type(active))!==BOOL)throw Error('direct-active-type');
   directPresentation={active,service:classes[service],
    show:method(classes[service],'ShowPokemonInfo','System.Void',[PK,BOOL,BOOL,'Niantic.Holoholo.UI.Pokemon.OpenHyperTrainingState',ACTION,ACTION,n=>n.startsWith('System.Action')&&n.includes('DismissParameters'),BOOL,BOOL,BOOL],false,
     [0x9a7ba18,'ff8302d1fd7b04a9fc6f05a9fa6706a9f85f07a9f65708a9f44f09a973b202d0']),
    callback:method(classes[ACTION],'Invoke','System.Void',[],false,null)};
  }catch(e){directPresentation=null;directPresentationError=String(e);}

  let transfer=null,transferError=null;

  try {

   if(!details||!classes[BAG]||!classes[DISPLAY]||!classes[RELEASE])throw Error('transfer-classes-unavailable');

   function typed(owner,name,offset,type){const f=raw(owner,name,offset);if(typeName(api,api.field_get_type(f))!==type)throw Error('transfer-field:'+name);return f;}

   function enumDefault(f,name){const k=api.class_from_type(api.field_get_type(f)),v=api.class_get_field_from_name(k,Memory.allocUtf8String(name));if(v.isNull()||!api.field_get_parent(v).equals(k)||(api.field_get_flags(v)&0x8050)!==0x8050)throw Error('transfer-enum:'+name);const out=Memory.alloc(4);api.field_static_get_value(v,out);return out.readS32();}

   const tf={resultStatus:enumI32Field(classes[RELEASE],'Status',0x10),bag:typed(classes[VIEW],'dsvj',0x70,'Niantic.Holoholo.IPokemonBag'),gm:typed(classes[VIEW],'dsvo',0x98,'IGameMasterData'),

    species:typed(classes[PK],'pokemonId_',0x28,INT),attack:typed(classes[PK],'individualAttack_',0x70,INT),defense:typed(classes[PK],'individualDefense_',0x74,INT),stamina:typed(classes[PK],'individualStamina_',0x78,INT),

    favorite:typed(classes[PK],'favorite_',0xb0,BOOL),egg:typed(classes[PK],'isEgg_',0x50,BOOL),display:typed(classes[PK],'pokemonDisplay_',0xd8,DISPLAY),events:refField(classes[PK],'originEvents_',0x188),

    limited:typed(classes[PK],'limitedPokemonIdentifier_',0x130,'System.String'),costume:enumI32Field(classes[DISPLAY],'Costume',0x10),originalCostume:enumI32Field(classes[DISPLAY],'OriginalCostume',0x40),

    background:refField(classes[DISPLAY],'LocationCard',0x58),art:enumI32Field(classes[DISPLAY],'NaturalArtType',0x70),artAsset:enumI32Field(classes[DISPLAY],'NaturalArtBackgroundAsset',0x74)};

   const eventClass=api.class_from_type(api.field_get_type(tf.events));

   const nestedIter=Memory.alloc(8);nestedIter.writePointer(ptr(0));let callbackClass=null;

   for(let i=0;i<256;i++){const k=api.class_get_nested_types(classes[BAG],nestedIter);if(k.isNull())break;

    if(/[.+/]ya$/.test(typeName(api,api.class_get_type(k)))&&api.class_get_declaring_type(k).equals(classes[BAG])){callbackClass=k;break;}}

   if(!callbackClass)throw Error('transfer-callback-class');

   tf.callbackPokemon=typed(callbackClass,'pokemon',0x20,PK);tf.callbackBag=typed(callbackClass,'<>4__this',0x10,BAG);

   const sizeEnum=name=>{const k=classes['Holoholo.Rpc.CharacterSize'],f=api.class_get_field_from_name(k,Memory.allocUtf8String(name)),v=Memory.alloc(4);if(f.isNull()||(api.field_get_flags(f)&0x8050)!==0x8050)throw Error('transfer-size-enum');api.field_static_get_value(f,v);return v.readS32();};
   transfer={sizes:['Xxs','Xs','M','Xl','Xxl'].map(sizeEnum),xxs:sizeEnum('Xxs'),xxl:sizeEnum('Xxl'),fields:tf,eventClass,callbackClass,resultSuccess:enumDefault(tf.resultStatus,'Success'),costumeNone:enumDefault(tf.costume,'Unset'),artNone:enumDefault(tf.art,'NaturalArtUnset'),assetNone:enumDefault(tf.artAsset,'NaturalBackgroundUnset'),methods:{

    result:method(callbackClass,'zlc','System.Void',[RELEASE],false,[0xa0534a0,'ff0302d1fe5f05a9f65706a9f44f07a9d5830290f30301aa']),

    error:method(callbackClass,'zld','System.Void',['System.String'],false,[0xa0538b4,'fe0f1df8f65701a9f44f02a9d5830290f30301aaf40300aa']),

    size:method(classes[PK],'PokemonCharacterSize','Holoholo.Rpc.CharacterSize',['IGameMasterData'],false,null),
    rare:method(classes[PK],'IsLegendaryOrMythicOrUltraBeast',BOOL,['IGameMasterData'],false,null),shiny:method(classes[PK],'get_IsShinyPokemon',BOOL,[],false,null),

    eventCount:method(eventClass,'get_Count',INT,[],false,null,true),

    get:method(classes[BAG],'GetPokemon',PK,['System.UInt64'],false,null),

    release:method(classes[BAG],'ReleasePokemon',n=>/^Niantic\.Promises\.IPromise(?:`1)?<Holoholo\.Rpc\.ReleasePokemonOutProto>$/.test(n),[PK],false,[0xa04d064,'ff4302d1fe2300f9fa6705a9f85f06a9f65707a9f44f08a9f38302d0f50301aa'])}};

  }catch(e){transferError=String(e);}

  let spin=null,spinError=null;

  try{

   if([SPINSTATE,SPINGUI,GESTURE,SPINNER,SPINBASE,SPINRESULT].some(n=>!classes[n]))throw Error('spin-classes-unavailable');

   function spinField(owner,name,offset,type){const f=raw(classes[owner],name,offset);if(typeName(api,api.field_get_type(f))!==type)throw Error('spin-field:'+name);return f;}

   const sf={gui:spinField(SPINSTATE,'deyd',0x128,'Niantic.Holoholo.Pokestop.IPokestopSpinnerInteractionGuiController'),gesture:spinField(SPINSTATE,'deyc',0x120,GESTURE),spinner:spinField(GESTURE,'dkbf',0x60,'Niantic.Holoholo.Map.IPoiSpinner'),result:enumI32Field(classes[SPINRESULT],'Result',0x10)};

   const ek=api.class_from_type(api.field_get_type(sf.result)),lit=api.class_get_field_from_name(ek,Memory.allocUtf8String('Success'));

   if(lit.isNull()||!api.field_get_parent(lit).equals(ek)||(api.field_get_flags(lit)&0x8050)!==0x8050)throw Error('spin-success-literal');

   const v=Memory.alloc(4);api.field_static_get_value(lit,v);

   spin={fields:sf,success:v.readS32(),methods:{

    enter:method(classes[SPINSTATE],'EnterState','System.Void',[],false,[0xa4ea31c,'ffc302d1fd7b05a9fc6f06a9fa6707a9f85f08a9f65709a9']),

    exit:method(classes[SPINSTATE],'ExitState','System.Void',[],false,[0xa4eb840,'fd7bbaa9fc6f01a9fa6702a9f85f03a9f65704a9f44f05a9']),

    result:method(classes[SPINSTATE],'bgff','System.Void',[SPINRESULT],false,[0xa4ec468,'ffc301d1fe6f02a9fa6703a9f85f04a9f65705a9f44f06a9']),

    close:method(classes[SPINGUI],'ClickExit','System.Void',[],false,[0xa4e5da4,'fe57bea9f44f01a9345f02f0f30300aa88f2673908010037']),

    spin:method(classes[SPINNER],'Spin','System.Void',['System.Single'],false,[0x9e63b34,'fe4fbfa9f30300aa51bcff977fc20339fe4fc1a8c0035fd6']),

    request:method(classes[SPINNER],'cnqj','System.Void',[],false,[0x9e63b54,'fe0f1df8f65701a9f44f02a9349302f0f30300aa88ce6139']),

    can:method(classes[SPINBASE],'get_CanSpin',BOOL,[],false,[0x9e514e8,'fe57bea9f44f01a9d49302b0f30300aa8832603908010037']),

    active:method(classes[GESTURE],'get_IsActive',BOOL,[],false,[0xa818d40,'00004239c0035fd6fe0f1df8f65701a9f44f02a9b54502b0'])}};

  }catch(e){spinError=String(e);}

  let spinCamera=null,spinCameraError=null;

  try{

   if(!spin||[APPROACH,RESOLVE,SPLINE].some(n=>!classes[n]))throw Error('spin-camera-classes');

   function cf(k,n,o,type){const f=raw(k,n,o);if(typeName(api,api.field_get_type(f))!==type)throw Error('spin-camera-field:'+n);return f;}

   const it=Memory.alloc(8);it.writePointer(ptr(0));let iterator=null;

   for(let i=0;i<256;i++){const k=api.class_get_nested_types(classes[SPLINE],it);if(k.isNull())break;if(/[.+/]cso$/.test(typeName(api,api.class_get_type(k)))&&api.class_get_declaring_type(k).equals(classes[SPLINE])){iterator=k;break;}}

   if(!iterator)throw Error('spin-camera-iterator');

   const owner=cf(iterator,'<>4__this',0x28,SPLINE),state=cf(iterator,'djjp',0x10,INT);

   cf(iterator,'djjv',0x50,'System.Single');

   spinCamera={iterator,owner,state,move:method(iterator,'MoveNext',BOOL,[],false,[0xa7b9460,'ffc302d1ea3300fde9a3066dfe3f00f9f85f08a9f65709a9']),states:[

    {klass:classes[APPROACH],phase:'in',camera:cf(classes[APPROACH],'splineCam',0x78,SPLINE),enter:method(classes[APPROACH],'EnterState','System.Void',[],false,[0xa4d166c,'ffc301d1fe2300f9f65705a9f44f06a9d45f02f0f30300aa']),exit:method(classes[APPROACH],'ExitState','System.Void',[],false,[0xa4d2174,'fe57bea9f44f01a9d45f02d0f30300aa889e663908010037'])},

    {klass:classes[RESOLVE],phase:'out',camera:cf(classes[RESOLVE],'splineCam',0x58,SPLINE),enter:method(classes[RESOLVE],'EnterState','System.Void',[],false,[0xa512b30,'fe57bea9f44f01a9d45d02d0f30300aa88ce6c3908010037']),exit:method(classes[RESOLVE],'ExitState','System.Void',[],false,[0xa51329c,'fe57bea9f44f01a9d45d02b0f30300aa88d26c3908010037'])}]};

  }catch(e){spinCameraError=String(e);}

  let items=null,itemsError=null;

  try{

   if([IBAG,ISERVICE,IRESPONSE,ITEM].some(n=>!classes[n]))throw Error('item-classes');

   function ityped(k,n,o,type){const f=o===null?api.class_get_field_from_name(k,Memory.allocUtf8String(n)):raw(k,n,o);if(f.isNull()||!api.field_get_parent(f).equals(k)||(api.field_get_flags(f)&0x50)||typeName(api,api.field_get_type(f))!==type)throw Error('item-field:'+n);return f;}

   const setType=n=>/^System\.Collections\.Generic\.ISet(?:`1)?<Holoholo\.Rpc\.Item>$/.test(n);

   const filterType=n=>/^System\.Func(?:`2)?<System\.ValueTuple(?:`2)?<Holoholo\.Rpc\.Item, ?Holoholo\.Rpc\.HoloItemType>, ?System\.Boolean>$/.test(n);

   const list=method(classes[ISERVICE],'cjpz',n=>/^System\.Collections\.Generic\.List(?:`1)?<.+ItemData>$/.test(n),[filterType,BOOL,filterType,n=>/^System\.Func(?:`2)?<Holoholo\.Rpc\.Item, ?System\.Boolean>$/.test(n),n=>/^System\.Action(?:`1)?<Holoholo\.Rpc\.Item>$/.test(n)],false,[163091344, "ff0307d1eaa300fde923156dfd7b16a9fc6f17a9fa6718a9"]);

   const lk=api.class_from_type(api.method_get_return_type(list.method)),get=api.class_get_method_from_name(lk,Memory.allocUtf8String('get_Item'),1),dk=api.class_from_type(api.method_get_return_type(get)),dn=typeName(api,api.class_get_type(dk));

   if(!/[.+/]ItemData$/.test(dn)&&dn!=='ItemData')throw Error('item-data-class');

   const nested=Memory.alloc(8);nested.writePointer(ptr(0));let cb=null;

   for(let i=0;i<256;i++){const k=api.class_get_nested_types(classes[IBAG],nested);if(k.isNull())break;if(/[.+/]wy$/.test(typeName(api,api.class_get_type(k)))&&api.class_get_declaring_type(k).equals(classes[IBAG])){cb=k;break;}}

   if(!cb)throw Error('item-callback-class');

   const prediction=ityped(cb,'prediction',0x18,'Holoholo.Rpc.HoloInventoryItemProto'),pk=api.class_from_type(api.field_get_type(prediction));

   const proto=method(pk,'get_Item','Holoholo.Rpc.ItemProto',[],false,null),ik=api.class_from_type(api.method_get_return_type(proto.method));

   const fields={delegateMethod:raw(classes[DELEGATE],'method',0x28),delegateTarget:raw(classes[DELEGATE],'m_target',0x20),bag:ityped(classes[ISERVICE],'ehsf',0x60,'Niantic.Holoholo.IItemBag'),id:enumI32Field(dk,'item',0x10),count:ityped(dk,'count',0x1c,INT),recyclable:ityped(dk,'recyclable',0x21,BOOL),callbackBag:ityped(cb,'<>4__this',0x10,IBAG),prediction,proto,protoId:ityped(ik,'Item',0x10,ITEM),status:enumI32Field(classes[IRESPONSE],'Result',0x10)};

   const ek=api.class_from_type(api.field_get_type(fields.status)),lit=api.class_get_field_from_name(ek,Memory.allocUtf8String('Success'));if(lit.isNull()||(api.field_get_flags(lit)&0x8050)!==0x8050)throw Error('item-success');const v=Memory.alloc(4);api.field_static_get_value(lit,v);

   const names={};const getFields=new NativeFunction(module.findExportByName('il2cpp_class_get_fields'),'pointer',['pointer','pointer']),getName=new NativeFunction(module.findExportByName('il2cpp_field_get_name'),'pointer',['pointer']);const ei=Memory.alloc(8);ei.writePointer(ptr(0));

   for(let i=0;i<2048;i++){const f=getFields(classes[ITEM],ei);if(f.isNull())break;if((api.field_get_flags(f)&0x8050)!==0x8050)continue;api.field_static_get_value(f,v);names[v.readS32()]=text(getName(f)).replace(/^Item/,'').replace(/([a-z0-9])([A-Z])/g,'$1 $2');}

   Object.assign(names,{1:'Poke Ball',401:'Incense',501:'Lure Module'});

   let lookup=null;try{

    const enumerate=new NativeFunction(module.findExportByName('il2cpp_class_get_methods'),'pointer',['pointer','pointer']);

    function select(k,n,ret,param,stat){const it=Memory.alloc(8);it.writePointer(ptr(0));for(let i=0;i<4096;i++){const m=enumerate(k,it);if(m.isNull())break;const impl=Memory.alloc(4);if(text(api.method_get_name(m))===n&&!api.method_is_generic(m)&&api.method_get_param_count(m)===param.length&&typeName(api,api.method_get_return_type(m))===ret&&Boolean(api.method_get_flags(m,impl)&16)===stat&&param.every((t,j)=>typeName(api,api.method_get_param(m,j))===t))return{method:m};}throw Error('item-lookup-method:'+n);}

   const map=classes['Niantic.Holoholo.MapSceneContext'],ctx=classes['Zenject.SceneContext'],container=classes['Zenject.DiContainer'],contract=classes['Niantic.Holoholo.UI.Items.IItemInventoryService'];if(map&&ctx&&container&&contract){

    const gui=classes['Niantic.Holoholo.UI.Items.ItemInventoryGuiService'],guiContract=classes['Niantic.Holoholo.UI.Items.IItemInventoryGuiService'];if(!gui||!guiContract)throw Error('item-gui-service');

    const ni=Memory.alloc(8);ni.writePointer(ptr(0));let singleton=null;for(let i=0;i<256;i++){const k=api.class_get_nested_types(gui,ni);if(k.isNull())break;if(/[.+/]<>c$/.test(typeName(api,api.class_get_type(k)))&&api.class_get_declaring_type(k).equals(gui)){singleton=k;break;}}if(!singleton)throw Error('item-filter-singleton');

    const tuple=n=>/^System\.ValueTuple(?:`2)?<Holoholo\.Rpc\.Item, ?Holoholo\.Rpc\.HoloItemType>$/.test(n);

    const usable=method(gui,'cjpm',BOOL,[tuple],false,[163081096, "fe5fbda9f65701a9f44f02a916aa02f034fc60d3f50301aa"]),show=method(singleton,'cjpd',BOOL,[tuple],false,[163083736, "20008052c0035fd6fe5fbda9f65701a9f44f02a916aa02d0"]);

    const instance=api.class_get_field_from_name(singleton,Memory.allocUtf8String('<>9'));if(instance.isNull()||!api.field_get_parent(instance).equals(singleton)||!(api.field_get_flags(instance)&16))throw Error('item-filter-instance');

    lookup={map,contract,gui,guiContract,singleton,instance,usable,show,funcType:api.method_get_param(list.method,0),

    reflect:new NativeFunction(module.findExportByName('il2cpp_method_get_object'),'pointer',['pointer','pointer']),initClass:new NativeFunction(module.findExportByName('il2cpp_runtime_class_init'),'void',['pointer']),

    createDelegate:select(classes[DELEGATE],'CreateDelegate','System.Delegate',['System.Type','System.Object','System.Reflection.MethodInfo'],true),typeObject:new NativeFunction(module.findExportByName('il2cpp_type_get_object'),'pointer',['pointer']),find:select(classes[OBJ],'FindObjectOfType',OBJ,['System.Type'],true),container:method(ctx,'get_Container','Zenject.DiContainer',[],false,null),resolve:select(container,'Resolve','System.Object',['System.Type'],false)};

   }}catch(_){}

   items={fields,dk,cb,names,lookup,success:(()=>{api.field_static_get_value(lit,v);return v.readS32();})(),methods:{list,

    init:method(classes[ISERVICE],'cjpx','System.Void',[],false,ITEMCODE.cjpx),

    count:method(lk,'get_Count',INT,[],false,null,true),get:method(lk,'get_Item',dn,[INT],false,null,true),

    expiring:method(classes[ISERVICE],'get_ExpiringItemsCopy',setType,[],false,ITEMCODE.get_ExpiringItemsCopy),

    quantity:method(classes[IBAG],'GetItemCount',INT,[ITEM],false,ITEMCODE.GetItemCount),

    recycle:method(classes[IBAG],'RecycleItem',n=>/^Niantic\.Promises\.IPromise(?:`1)?<Holoholo\.Rpc\.RecycleItemOutProto>$/.test(n),[dn,INT,setType],false,ITEMCODE.RecycleItem),

    result:method(cb,'zid','System.Void',[IRESPONSE],false,ITEMCODE.zid),error:method(cb,'zie','System.Void',['System.String'],false,ITEMCODE.zie)}};

  }catch(e){itemsError=String(e);}

  let rocket=null,rocketError=null;

  try{

   if([ROCKET,RUI,RDIR,RCHARGE,RSHIELD,'UnityEngine.UI.Selectable'].some(n=>!classes[n]))throw Error('rocket-classes-unavailable');

   function rm(k,o,n,ret,params=[]){return method(classes[k],n,ret,params,false,ROCKETCODE[o+':'+n]);}

   function rf(k,n,off,type){const f=raw(classes[k],n,off);if(typeName(api,api.field_get_type(f))!==type)throw Error('rocket-field:'+n);return f;}

   const vm=(k,o,n,ret,params=[])=>method(classes[k],n,ret,params,false,RVCode[o+':'+n]);

   const vnext={fields:{gesture:refField(classes[RVUI],'eovv',0x260),enabled:rf(RVBASE,'FastAttackInputEnabled',0x9a,BOOL),tap:refField(classes[RVBASE],'tapGesture',0x70),button:refField(classes[RVCHARGE],'attackButton',0x28)},methods:{update:vm(RVUI,31113,'UpdateUiWidgets','System.Void',['Niantic.Holoholo.VNext.BattleState']),close:vm(RVUI,31113,'HandleDismiss','System.Void'),blocked:vm(RVUI,31113,'get_IsInputBlocked',BOOL),fast:vm(RVGEST,31443,'cqul','System.Void',['System.Object']),observe:vm(RVCHARGE,31616,'ObserveBattleState','System.Void',['Niantic.Holoholo.VNext.BattleState']),charge:vm(RVCHARGE,31616,'ChargeAttackButtonTapped','System.Void'),charged:vm(RVCHARGE,31616,'get_IsCharged',BOOL),visible:vm(RVCHARGE,31616,'get_IsVisible',BOOL)}};

   const vector=classes['UnityEngine.Vector3'];if(!vector||api.class_value_size(vector,align)!==12)throw Error('minigame-vector-abi');

   const mini={fields:{collider:refField(classes[RMINI],'tapCollider',0xd8),running:rf(RMINIBASE,'combatIsRunning',0xb0,BOOL)},methods:{

    update:method(classes[RMINI],'UpdateMinigame','System.Void',['System.Int64'],false,RMCode.UpdateMinigame),exit:method(classes[RMINI],'ExitGame','System.Void',[],false,RMCode.ExitGame),hide:method(classes[RMINI],'Hide','System.Void',[],false,RMCode.Hide),destroy:method(classes[RMINI],'OnDestroy','System.Void',[],false,RMCode.OnDestroy),

    transform:method(classes['UnityEngine.Component'],'get_transform','UnityEngine.Transform',[],false,null),gameObject:method(classes['UnityEngine.Component'],'get_gameObject','UnityEngine.GameObject',[],false,null),

    scale:method(classes['UnityEngine.Transform'],'get_localScale','UnityEngine.Vector3',[],false,null),setScale:method(classes['UnityEngine.Transform'],'set_localScale','System.Void',['UnityEngine.Vector3'],false,null),active:method(classes['UnityEngine.GameObject'],'get_activeSelf',BOOL,[],false,null),setActive:method(classes['UnityEngine.GameObject'],'SetActive','System.Void',[BOOL],false,null)}};

   rocket={vnext,mini,fields:{first:refField(classes[RUI],'dofo',0x2c0),second:refField(classes[RUI],'dofp',0x2c8),charged:rf(RCHARGE,'<IsCharged>k__BackingField',0x1a0,BOOL),input:rf(RCHARGE,'<InputEnabled>k__BackingField',0x1a3,BOOL),shields:rf(RSHIELD,'dnve',0x178,INT),button:refField(classes[RSHIELD],'shieldButton',0x118)},methods:{

    enter:rm(ROCKET,7137,'EnterState','System.Void',['Niantic.Platform.GameStates.StateLogic.IStateApi',n=>n===ROCKET+'.Data']),exit:rm(ROCKET,7137,'ExitState','System.Void'),

    update:rm(RUI,7100,'UpdateActionsUI','System.Void',[BOOL]),ui:rm(RUI,7100,'Initialize','System.Void',[n=>n===RUI+'.Data']),close:rm(RUI,7100,'HandleDismiss','System.Void'),director:rm(RUI,7100,'bpro','Niantic.Holoholo.Combat.ICombatDirectorV2'),

    active:rm(RDIR,6533,'get_IsInActiveState',BOOL),fast:rm(RDIR,6533,'TryFastAttack','Holoholo.Rpc.CombatActionProto'),

    charge:rm(RCHARGE,7064,'OnTap','System.Void'),visible:rm(RCHARGE,7064,'get_IsVisible',BOOL),

    prompt:rm(RSHIELD,6971,'ShowShieldPrompt','System.Void',[BOOL]),shield:rm(RSHIELD,6971,'ShieldUiClicked','System.Void'),shieldClose:rm(RSHIELD,6971,'HandleDismiss','System.Void'),

    interactable:method(classes['UnityEngine.UI.Selectable'],'IsInteractable',BOOL,[],false,null)}};

  }catch(e){rocketError=String(e);}

  let battles=null,battlesError=null;

  try{

   if(!rocket||!rocket.vnext)throw Error('vnext-attack-support');

   const bk=o=>classes[BATTLE_TYPES[o]||RVBASE];

   const bm=(o,n,ret,params=[])=>method(bk(o),n,ret,params,false,BATTLE_CODE[o+':'+n]);

   const scopes=[{mode:0,klass:bk(31514),enter:bm(31514,'EnterState','System.Void',['Niantic.Platform.GameStates.StateLogic.IStateApi','Niantic.Holoholo.Raid.RaidBattleLaunchData']),exit:bm(31514,'ExitState','System.Void')},

    {mode:1,klass:bk(10591),enter:bm(10591,'EnterState','System.Void'),exit:bm(10591,'ExitState','System.Void')},

    {mode:2,klass:bk(31244),enter:bm(31244,'EnterState','System.Void',['Niantic.Platform.GameStates.StateLogic.IStateApi','Niantic.Holoholo.Bread.BreadLaunchData']),exit:bm(31244,'ExitState','System.Void')}];

   const maxType=enumI32Field(bk(31280),'<ActiveBreadMoveType>k__BackingField',0x134),enumClass=api.class_from_type(api.field_get_type(maxType)),lit=api.class_get_field_from_name(enumClass,Memory.allocUtf8String('BreadAttack'));

   if(lit.isNull()||(api.field_get_flags(lit)&0x8050)!==0x8050)throw Error('max-attack-literal');const value=Memory.alloc(4);api.field_static_get_value(lit,value);

   const dodge= bm(31351,'cqpd','System.Void',[n=>/[.+/]Direction$/.test(n)]),direction=api.class_from_type(api.method_get_param(dodge.method,0));

   if(!api.class_is_enum(direction)||typeName(api,api.class_enum_basetype(direction))!==INT)throw Error('dodge-direction-type');

   const left=api.class_get_field_from_name(direction,Memory.allocUtf8String('Left')),leftValue=Memory.alloc(4);

   if(left.isNull()||(api.field_get_flags(left)&0x8050)!==0x8050)throw Error('dodge-left-literal');api.field_static_get_value(left,leftValue);

   let gymIterator=null;const gi=Memory.alloc(8);gi.writePointer(ptr(0));for(let i=0;i<64;i++){const k=api.class_get_nested_types(bk(9284),gi);if(k.isNull())break;if(/[.+/]epg$/.test(typeName(api,api.class_get_type(k)))){gymIterator=k;break;}}

   if(!gymIterator)throw Error('gym-warning-iterator');

   const gymWarning=method(gymIterator,'MoveNext',BOOL,[],false,BATTLE_CODE['9283:MoveNext']),gymWarningState=raw(gymIterator,'duwi',0x10);

   const battleStatus=enumI32Field(bk(44226),'BattleStatus',0x64),statusClass=api.class_from_type(api.field_get_type(battleStatus));

   function battleStatusValue(name){const f=api.class_get_field_from_name(statusClass,Memory.allocUtf8String(name)),v=Memory.alloc(4);if(f.isNull()||(api.field_get_flags(f)&0x8050)!==0x8050)throw Error('battle-status:'+name);api.field_static_get_value(f,v);return v.readS32();}

   battles={scopes,swaps:[{owner:9322,mode:1,open:'Open',close:['Dismiss','OnDestroy'],show:'get_IsOpen'},{owner:31639,mode:0,open:'Open',close:['Dismiss','OnDestroy'],show:'get_IsOpen'},{owner:31337,mode:2,open:'OpenSwapMenu',close:['HideSwapMenu','Cleanup'],show:'get_IsShowing'}].map(q=>({mode:q.mode,klass:bk(q.owner),open:bm(q.owner,q.open,'System.Void'),close:q.close.map(n=>bm(q.owner,n,'System.Void')),show:bm(q.owner,q.show,BOOL)})),statusActive:battleStatusValue('Active'),statusUnset:battleStatusValue('Unset'),dodgeLeft:leftValue.readS32(),gymIterator,gymWarningState,maxAttack:value.readS32(),fields:{maxGesture:refField(bk(31244),'epkk',0x70),director:refField(bk(31351),'epus',0x20),battleStatus,legacyFlick:refField(bk(9182),'horizontalFlickGesture',0x60),legacyTap:refField(bk(9182),'tapGesture',0x58),legacyButton:refField(bk(9308),'attackButton',0x28),maxButton:refField(bk(31280),'button',0x98),maxType},methods:{

    currentState:bm(31569,'get_CurrentState',BATTLE_TYPES[44226]),raidFastAction:bm(31351,'cqpa','System.Void'),destroy:bm(31351,'OnDestroy','System.Void'),dodge,gymWarning,raidWarning:bm(31623,'crlu','System.Void'),maxWarning:bm(31263,'cqim','System.Void',['System.Single']),legacyDodge:bm(9182,'bwqu','System.Void',['System.Object','System.EventArgs']),

    enable:bm(31351,'OnEnable','System.Void'),disable:bm(31351,'OnDisable','System.Void'),buttons:bm(31351,'SetChargeAttackButtons','System.Void',[RVCHARGE+'[]']),

    raidFast:bm(31499,'cqjz','System.Void',['System.Object','System.EventArgs']),maxFast:bm(31285,'cqjz','System.Void',['System.Object','System.EventArgs']),

    legacyEnable:bm(9182,'OnEnable','System.Void'),legacyDisable:bm(9182,'OnDisable','System.Void'),legacyButtons:bm(9182,'SetChargeAttackButtons','System.Void',[BATTLE_TYPES[9308]+'[]']),legacyFast:bm(9182,'bwqr','System.Void',['System.Object','System.EventArgs']),

    legacyInit:bm(9308,'Init','System.Void',['Niantic.Holoholo.Battle.BattlePokemon','Niantic.Holoholo.Battle.BattlePokemon','UnityEngine.Vector3']),legacyCharged:bm(9308,'get_IsCharged',BOOL),legacyCharge:bm(9308,'ChargeAttackButtonTapped','System.Void'),

    maxRefresh:bm(31280,'Refresh','System.Void',[n=>n===BATTLE_TYPES[31280]+'.Data']),maxCleanup:bm(31280,'Cleanup','System.Void'),

    active:method(classes['UnityEngine.Behaviour'],'get_isActiveAndEnabled',BOOL,[],false,null),press:method(classes['UnityEngine.UI.Button'],'Press','System.Void',[],false,null)}};

  }catch(e){battlesError=String(e);}

  let berries=null,berriesError=null;

  try{if(!items)throw Error('item-bag-unavailable');const k=classes[BERRY],bm=(n,ret,params=[])=>method(k,n,ret,params,false,BERRY_CODE[n]);

   for(const [name,offset]of [['confirmationDelay',0x108],['postConfirmationDelay',0x10c]]){const f=raw(classes[FEEDGUI],name,offset);if(typeName(api,api.field_get_type(f))!=='System.Single')throw Error('berry-delay-type');}

   berries={fields:{image:refField(classes[FEEDGUI],'itemImage',0xf0),bag:refField(k,'drql',0x148),gui:refField(k,'drrv',0x248),ui:refField(k,'<EncounterUI>k__BackingField',0x298),current:enumI32Field(k,'<CurrentItem>k__BackingField',0x2a8)},methods:{visible:method(classes['UnityEngine.Behaviour'],'get_enabled',BOOL,[],false,null),setVisible:method(classes['UnityEngine.Behaviour'],'set_enabled','System.Void',[BOOL],false,null),enter:bm('EnterState','System.Void'),exit:bm('ExitState','System.Void'),select:bm('SelectBerry','System.Void',[ITEM]),can:bm('get_CanUseBerry',BOOL),ball:bm('get_PokeballInPlay',BOOL),photo:bm('get_IsInPhotoMode',BOOL),confirm:method(classes[FEEDGUI],'ClickConfirm','System.Void',[],false,BERRY_CODE.ClickConfirm)}};

   const ball=classes['Niantic.Holoholo.Encounter.Pokeball'],throwName='Niantic.Holoholo.Encounter.PokeballThrow',throwClass=classes[throwName],va=Memory.alloc(4);if(!api.class_is_valuetype(throwClass)||api.class_value_size(throwClass,va)!==12||va.readU32()!==4)throw Error('berry-impact-throw-abi');

   for(const [n,type,off]of [['BallType',ITEM,16],['ReticleSize','System.Single',20],['HitBullseye',BOOL,24],['Spinning',BOOL,25],['Missed',BOOL,26]])if(typeName(api,api.field_get_type(raw(throwClass,n,off)))!==type)throw Error('berry-impact-throw-field:'+n);

   let callback=null;const bi=Memory.alloc(8);bi.writePointer(ptr(0));for(let i=0;i<64;i++){const c=api.class_get_nested_types(k,bi);if(c.isNull())break;if(/[.+/]ebn$/.test(typeName(api,api.class_get_type(c)))&&api.class_get_declaring_type(c).equals(k)){callback=c;break;}}if(!callback)throw Error('berry-confirm-callback');

   berries.callback=callback;berries.fields.callbackScope=refField(callback,'<>4__this',0x10);berries.fields.callbackBerry=enumI32Field(callback,'berryType',0x18);

   berries.methods.direct=method(callback,'btdx','System.Void',[BOOL],false,BERRY_THROW_CODE.btdx);

   berries.methods.result=method(callback,'btdy','System.Void',['Holoholo.Rpc.UseItemEncounterOutProto'],false,BERRY_THROW_CODE.btdy);berries.methods.error=method(callback,'btdz','System.Void',['System.String'],false,BERRY_THROW_CODE.btdz);

   berries.methods.submit=method(ball,'btyl','System.Void',[throwName],false,BERRY_THROW_CODE.submit);berries.methods.peek=method(ball,'btxu','Holoholo.Rpc.CatchPokemonOutProto',[],false,BERRY_THROW_CODE.peek);

   berries.methods.bread=method(ball,'get_HoldingBreadBall',BOOL,[],false,BERRY_THROW_CODE.get_HoldingBreadBall);berries.methods.ballType=method(ball,'get_BallType',ITEM,[],false,BERRY_THROW_CODE.get_BallType);

  }catch(e){berries=null;berriesError=String(e);}


  let incubator=null,incubatorError=null;
  try{
   const service='Niantic.Holoholo.Items.IncubatorService',contract='Niantic.Holoholo.Items.IIncubatorService',inc='Holoholo.Rpc.EggIncubatorProto';
   if(!items||!items.lookup||![service,contract,inc,'System.Collections.IEnumerable',VGP.player,VGP.playerContract,VGP.bagContract].every(n=>classes[n]))throw Error('incubator-dependencies');
   const typed=(k,n,o,ty)=>{const f=raw(classes[k],n,o);if(typeName(api,api.field_get_type(f))!==ty)throw Error('incubator-field:'+n);return f;};
   const literal=(k,n)=>{const f=api.class_get_field_from_name(k,Memory.allocUtf8String(n)),v=Memory.alloc(4);if(f.isNull()||(api.field_get_flags(f)&0x8050)!==0x8050)throw Error('incubator-enum:'+n);api.field_static_get_value(f,v);return v.readS32();};
   const f={egg:typed(PK,'isEgg_',0x50,BOOL),id:typed(PK,'id_',0x20,'System.UInt64'),target:typed(PK,'eggKmWalkedTarget_',0x58,'System.Double'),start:typed(PK,'eggKmWalkedStart_',0x60,'System.Double'),assignment:typed(PK,'eggIncubatorId_',0x98,'System.String'),eggType:enumI32Field(classes[PK],'eggType_',0x154),item:typed(inc,'Item',0x18,ITEM),incId:typed(inc,'ItemId',0x10,'System.String'),pokemonId:typed(inc,'PokemonId',0x28,'System.Int64'),expiry:typed(inc,'UnconvertedLocalExpirationTimeMs',0x40,'System.Int64')};
   const m={put:method(classes[service],'PutEggInIncubator',n=>/^Niantic\.Promises\.IPromise(?:`1)?<Holoholo\.Rpc\.UseItemEggIncubatorOutProto>$/.test(n),['System.Int64',inc],false,[163477644,'ffc301d1fe1300f9fa6703a9f85f04a9f65705a9f44f06a914a702d0f60302aa']),
    incubators:method(classes[VGP.player],'get_Incubators',n=>/^System\.Collections\.Generic\.IEnumerable(?:`1)?<Holoholo\.Rpc\.EggIncubatorProto>$/.test(n),[],false,[178505260,'fe57bea9f44f01a9943402d0f30300aa88125c3908010037200b02b000801b91']),
    eggs:method(classes[BAG],'get_AllPokemon',n=>/^System\.Collections\.Generic\.ICollection(?:`1)?<Holoholo\.Rpc\.PokemonProto>$/.test(n),[],false,[168081584,'fe0f1df8f65701a9f44f02a914840290f30300aa889a4f3908010037e05b02f0']),
    enumerate:method(classes['System.Collections.IEnumerable'],'GetEnumerator','System.Collections.IEnumerator',[],false,null),
    move:method(classes['System.Collections.IEnumerator'],'MoveNext',BOOL,[],false,null),
    current:method(classes['System.Collections.IEnumerator'],'get_Current','System.Object',[],false,null),
    dispose:method(classes['System.IDisposable'],'Dispose','System.Void',[],false,null)};
   incubator={service,contract,inc,f,m,unlimited:literal(classes[ITEM],'IncubatorBasicUnlimited'),special:literal(api.class_from_type(api.field_get_type(f.eggType)),'EggTypeSpecial')};
  }catch(e){incubatorError=String(e);incubator=null;}

  let buddy=null,buddyError=null;

  try{if(!items||!items.lookup)throw Error('buddy-item-lookup');

   const bm=(o,n,ret,params=[],stat=false)=>method(classes[BUDDY_TYPES[o]],n,ret,params,stat,BUDDY_CODE[o+'.'+n]);

   const bf=(o,n,off)=>refField(classes[BUDDY_TYPES[o]],n,off),stats='Holoholo.Rpc.BuddyObservedData';

   let callback=null;const it=Memory.alloc(8);it.writePointer(ptr(0));for(let i=0;i<64;i++){const k=api.class_get_nested_types(classes[BUDDY_TYPES[7768]],it);if(k.isNull())break;if(/[.+/]dvh$/.test(typeName(api,api.class_get_type(k)))&&api.class_get_declaring_type(k).equals(classes[BUDDY_TYPES[7768]])){callback=k;break;}}

   if(!callback)throw Error('buddy-feed-callback');

   const result=enumI32Field(classes['Holoholo.Rpc.BuddyFeedingOutProto'],'Result',0x10),ek=api.class_from_type(api.field_get_type(result)),lit=api.class_get_field_from_name(ek,Memory.allocUtf8String('Success')),v=Memory.alloc(4);

   if(lit.isNull()||(api.field_get_flags(lit)&0x8050)!==0x8050)throw Error('buddy-feed-success');api.field_static_get_value(lit,v);

   buddy={success:v.readS32(),callback,contract:classes['Niantic.Holoholo.Buddy.IBuddyStatsService'],fields:{rpc:bf(7769,'dpsj',0x58),pokemon:bf(7769,'dpsi',0x50),bag:bf(7768,'dpsh',0x40),callbackRpc:refField(callback,'<>4__this',0x18),result,buddyId:raw(classes['Holoholo.Rpc.BuddyPokemonProto'],'BuddyPokemonId',0x10),feedStats:refField(classes[stats],'BuddyFeedStats',0x40)},methods:{

    stats:bm(7769,'get_BuddyStats',stats),has:bm(8109,'get_HasBuddy',BOOL),pokemon:bm(8109,'get_BuddyPokemon','Holoholo.Rpc.BuddyPokemonProto'),

    remaining:bm(7757,'OnMapRemainingSec','System.Single',[stats],true),fullness:bm(7757,'PreMapFullnessPercentage','System.Single',[stats],true),cooldown:bm(7757,'InFullnessCooldown',BOOL,[stats],true),

    feed:bm(7768,'Feed',n=>/^Niantic\.Promises\.IPromise(?:`1)?<Holoholo\.Rpc\.BuddyFeedingOutProto>$/.test(n),[ITEM,INT]),result:method(callback,'brhd','System.Void',['Holoholo.Rpc.BuddyFeedingOutProto'],false,BUDDY_CODE['7763.brhd'])}};

   if(typeName(api,api.field_get_type(buddy.fields.buddyId))!=='System.UInt64')throw Error('buddy-id-type');

  }catch(e){buddy=null;buddyError=String(e);}

  let gifts=null,giftsError=null;

  try{

   const gm=(o,n,ret,params=[])=>method(classes[GIFT_TYPES[o]],n,ret,params,false,GIFT_CODE[o+'.'+n]);

   const gf=(o,n,off)=>refField(classes[GIFT_TYPES[o]],n,off);

   const data=gf(5936,'thisData',0x460),dataClass=api.class_from_type(api.field_get_type(data));

   const panelFriend=refField(dataClass,'FriendProto',0x18);

   const friendClass=classes['Niantic.Platform.Internal.Protos.FriendDetailsProto'],playerClass=classes['Niantic.Platform.Internal.Protos.PlayerSummaryProto'];

   const ms={profileOpen:gm(5916,'HandleOpenComplete','System.Void'),profileClose:gm(5916,'HandleDismiss','System.Void'),panel:gm(5916,'get_CurrentlyOpenFriendProfileInfoPanel',GIFT_TYPES[5936]),disabled:gm(5916,'get_ActionButtonsDisabled',BOOL),check:gm(5936,'CheckOnGift',BOOL),choose:gm(5936,'OnGiftClick','System.Void'),

    openReady:gm(6240,'HandleOpenComplete','System.Void'),openClose:gm(6240,'HandleDismiss','System.Void'),open:gm(6240,'OnOpenClick','System.Void'),

    sendReady:gm(6258,'HandleOpenComplete','System.Void'),sendClose:gm(6258,'HandleDismiss','System.Void'),send:gm(6258,'OnSendClick','System.Void'),stickers:gm(6258,'OnStickersClick','System.Void'),

    listInit:gm(6268,'Initialize','System.Void',[n=>n.endsWith('.Data')]),listReady:gm(6268,'HandleOpenComplete','System.Void'),listClose:gm(6268,'HandleDismiss','System.Void'),

    giftUpdate:gm(6211,'UpdateData','System.Void',[INT,'Holoholo.Rpc.GiftBoxDetailsProto']),giftBox:gm(6211,'GiftBox','Holoholo.Rpc.GiftBoxDetailsProto',[INT]),giftClick:gm(6211,'OnClick','System.Void',[INT]),

    stickerInit:gm(6176,'Reinitialize','System.Void',[n=>n.endsWith('.Initializer')]),stickerClick:gm(6176,'Click','System.Void'),sheetReady:gm(6195,'HandleOpenComplete','System.Void'),sheetClose:gm(6195,'HandleDismiss','System.Void'),

    inventory:gm(6164,'GetStickerInventory',n=>/^System\.Collections\.Generic\.List(?:`1)?<Holoholo\.Rpc\.StickerProto>$/.test(n),[BOOL]),selectSticker:gm(6258,'bmzx','System.Void',['Holoholo.Rpc.StickerProto']),

    quantity:gm(6164,'StickerCountExcludingReserved',INT,['Holoholo.Rpc.StickerProto']),anyStickers:gm(6164,'AnyStickers',BOOL),

    active:method(classes['UnityEngine.Behaviour'],'get_isActiveAndEnabled',BOOL,[],false,null),interactable:method(classes['UnityEngine.UI.Selectable'],'IsInteractable',BOOL,[],false,null)};

   const listData=api.class_from_type(api.method_get_param(ms.listInit.method,0));

   const typed=(k,n,off,ty)=>{const f=raw(k,n,off);if(typeName(api,api.field_get_type(f))!==ty)throw Error('gift-field-type:'+n);return f;};

   gifts={methods:ms,fields:{data,panelFriend,player:refField(friendClass,'player_',0x18),playerId:typed(playerClass,'playerId_',0x18,'System.String'),

    sender:typed(classes['Holoholo.Rpc.GiftBoxDetailsProto'],'SenderId',0x18,'System.String'),openDetails:gf(6240,'dlst',0x290),

    sendFriend:gf(6258,'dlvg',0x2d0),sendSticker:gf(6258,'dlvh',0x2d8),stickerService:gf(6258,'dluq',0x250),

    openButton:gf(6240,'openButton',0x150),sendButton:gf(6258,'sendButton',0x118),chooseButton:gf(5936,'sendGiftButton',0x160),stickerButton:gf(6258,'stickerButton',0x150),

    widgetButton:gf(6176,'button',0x70),widgetSticker:gf(6176,'dlla',0x118),

    deleteMode:typed(listData,'ShowDeleteIcon',0x18,BOOL),surprise:typed(listData,'IsSurprise',0x28,BOOL)}};

   const ff=gifts.fields,mm=gifts.methods;gifts.stickerListClass=api.class_from_type(api.method_get_return_type(mm.inventory.method));

   mm.stickerCount=method(gifts.stickerListClass,'get_Count',INT,[],false,null,true);mm.stickerItem=method(gifts.stickerListClass,'get_Item','Holoholo.Rpc.StickerProto',[INT],false,null,true);let sequence=null;const si=Memory.alloc(8);si.writePointer(ptr(0));

   for(let i=0;i<64;i++){const k=api.class_get_nested_types(classes[GIFT_TYPES[6240]],si);if(k.isNull())break;if(/[.+/]ddh$/.test(typeName(api,api.class_get_type(k)))&&api.class_get_declaring_type(k).equals(classes[GIFT_TYPES[6240]])){sequence=k;break;}}

   if(!sequence)throw Error('gift-presentation-iterator-missing');classes[GIFT_OPEN_SEQUENCE]=sequence;

   ff.sequenceGui=refField(sequence,'<>4__this',0x20);ff.sequenceResponse=refField(sequence,'response',0x28);ff.sequenceState=typed(sequence,'dlrm',0x10,INT);

   ff.openResult=enumI32Field(classes['Holoholo.Rpc.OpenGiftOutProto'],'Result',0x10);

   const ek=api.class_from_type(api.field_get_type(ff.openResult)),lit=api.class_get_field_from_name(ek,Memory.allocUtf8String('Success')),ev=Memory.alloc(4);

   if(lit.isNull()||!api.field_get_parent(lit).equals(ek)||(api.field_get_flags(lit)&0x8050)!==0x8050)throw Error('gift-success-literal');api.field_static_get_value(lit,ev);gifts.openSuccess=ev.readS32();

   mm.sequence=method(sequence,'MoveNext',BOOL,[],false,GIFT_OPEN_SEQUENCE_CODE);

   ff.listItems=refField(listData,'GiftBoxDetailsProtos',0x20);gifts.listClass=api.class_from_type(api.field_get_type(ff.listItems));

   mm.listCount=method(gifts.listClass,'get_Count',INT,[],false,null,true);mm.listItem=method(gifts.listClass,'get_Item','Holoholo.Rpc.GiftBoxDetailsProto',[INT],false,null,true);

   ff.selected=gf(6268,'GiftBoxSelected',0x188);gifts.selectedClass=api.class_from_type(api.field_get_type(ff.selected));

   mm.selectFirst=method(gifts.selectedClass,'Invoke','System.Void',['Holoholo.Rpc.GiftBoxDetailsProto'],false,null,true);

   mm.listExit=gm(6268,'ExitGui','System.Void');mm.sendResult=gm(6258,'bnah','System.Void',['Holoholo.Rpc.SendGiftOutProto']);

   ff.sendResult=enumI32Field(classes['Holoholo.Rpc.SendGiftOutProto'],'Result',0x10);

   const sk=api.class_from_type(api.field_get_type(ff.sendResult)),sl=api.class_get_field_from_name(sk,Memory.allocUtf8String('Success'));if(sl.isNull()||(api.field_get_flags(sl)&0x8050)!==0x8050)throw Error('gift-send-success');api.field_static_get_value(sl,ev);gifts.sendSuccess=ev.readS32();

   ff.rows=gf(6268,'dlwk',0x1a0);ff.listSurprise=typed(classes[GIFT_TYPES[6268]],'dlwm',0x1b0,BOOL);

   gifts.rowsClass=api.class_from_type(api.field_get_type(ff.rows));mm.rowCount=method(gifts.rowsClass,'get_Count',INT,[],false,null,true);mm.rowItem=method(gifts.rowsClass,'get_Item','Niantic.Holoholo.Social.Gifting.UI.IGiftItemView2Widget',[INT],false,null,true);

   mm.rpcSend=gm(6149,'SendGift',n=>/^Niantic\.Promises\.IPromise(?:`1)?<Holoholo\.Rpc\.SendGiftOutProto>$/.test(n),['System.UInt64','System.String','System.String','Holoholo.Rpc.StickerProto',BOOL]);

   mm.sendable=gm(6154,'get_SendableGiftsInInventory',n=>/^System\.Collections\.Generic\.IEnumerable(?:`1)?<Holoholo\.Rpc\.GiftBoxProto>$/.test(n));

   mm.reserve=gm(6164,'ReserveStickers','System.Void',['System.String',INT]);mm.returnSticker=gm(6164,'ReturnReservedStickers','System.Void',['System.String',INT]);

   ff.panelGifting=gf(5936,'dkrv',0x2e0);ff.panelRpc=gf(5936,'dkrw',0x2e8);ff.rpcStickers=gf(6149,'dlil',0x30);

   ff.giftId=typed(classes['Holoholo.Rpc.GiftBoxProto'],'GiftboxId',0x10,'System.UInt64');ff.stickerId=typed(classes['Holoholo.Rpc.StickerProto'],'StickerId',0x10,'System.String');

   ff.checkResult=enumI32Field(classes[GIFT_TYPES[5936]],'dktn',0x450);ff.checkPending=typed(classes[GIFT_TYPES[5936]],'dkto',0x454,BOOL);

   const ck=api.class_from_type(api.field_get_type(ff.checkResult)),cl=api.class_get_field_from_name(ck,Memory.allocUtf8String('Success'));if(cl.isNull()||(api.field_get_flags(cl)&0x8050)!==0x8050)throw Error('gift-check-success');api.field_static_get_value(cl,ev);gifts.checkSuccess=ev.readS32();

   const iterable=api.class_from_type(api.method_get_return_type(mm.sendable.method));

   mm.getEnumerator=method(iterable,'GetEnumerator',n=>/^System\.Collections\.Generic\.IEnumerator(?:`1)?<Holoholo\.Rpc\.GiftBoxProto>$/.test(n),[],false,null,true);

   const enumerator=api.class_from_type(api.method_get_return_type(mm.getEnumerator.method));mm.currentGift=method(enumerator,'get_Current','Holoholo.Rpc.GiftBoxProto',[],false,null,true);

   mm.moveGift=method(classes['System.Collections.IEnumerator'],'MoveNext',BOOL,[],false,null);mm.disposeGift=method(classes['System.IDisposable'],'Dispose','System.Void',[],false,null);

   ff.niaUtil=gf(5936,'dksq',0x388);const nk=api.class_from_type(api.field_get_type(ff.niaUtil)),ni=Memory.alloc(8);ni.writePointer(ptr(0));

   for(let i=0;i<64;i++){const q=api.class_get_methods(nk,ni);if(q.isNull())break;if(text(api.method_get_name(q))==='GetPlayerIdOrNiaAccountId'&&api.method_get_param_count(q)===1&&typeName(api,api.method_get_param(q,0))==='Niantic.Platform.Internal.Protos.PlayerSummaryProto'&&typeName(api,api.method_get_return_type(q))==='System.String'){mm.niaId={method:q};break;}}

   if(!mm.niaId)throw Error('gift-nia-method');

   let callback=null;const ci=Memory.alloc(8);ci.writePointer(ptr(0));for(let i=0;i<64;i++){const k=api.class_get_nested_types(classes[GIFT_TYPES[6149]],ci);if(k.isNull())break;if(/[.+/]dcg$/.test(typeName(api,api.class_get_type(k)))&&api.class_get_declaring_type(k).equals(classes[GIFT_TYPES[6149]])){callback=k;break;}}

   if(!callback)throw Error('gift-send-callback');gifts.callbackClass=callback;ff.callbackService=refField(callback,'<>4__this',0x10);ff.callbackId=typed(callback,'playerId',0x18,'System.String');

   mm.rpcResult=method(callback,'bmnz','System.Void',['Holoholo.Rpc.SendGiftOutProto'],false,GIFT_CODE['6147.bmnz']);mm.rpcFinally=method(callback,'bmoa','System.Void',[],false,GIFT_CODE['6147.bmoa']);

   gifts.sendDelays=[['dlvj',0x2e4],['dlvk',0x2e8],['dlvl',0x2ec],['dlvm',0x2f0],['stickerButtonFadeDurationSeconds',0x160],['stickerButtonDelayBeforeFadeSeconds',0x164]].map(([n,off])=>{typed(classes[GIFT_TYPES[6258]],n,off,'System.Single');return off;});

  }catch(e){gifts=null;giftsError=String(e);}

  let spawn=null,spawnError=null;

  try{spawn=method(classes[SPAWN],'cmwe','System.Double',[],false,[0x9dd7438,'fe57bea9f44f01a9949702f0f30300aa88525639e8020037']);}catch(e){spawnError=String(e);}


  let vgp=null,vgpError=null;
  try{
   if(!items||Object.values(VGP).some(n=>!classes[n]))throw Error('vgp-dependencies');
   const m={},f={},k=n=>classes[VGP[n]];
   const typed=(owner,name,offset,type)=>{const f=raw(owner,name,offset);if(typeName(api,api.field_get_type(f))!==type)throw Error('vgp-field-type:'+name);return f;};
   const vm=(key,owner,name,ret,args=[])=>m[key]=method(owner,name,ret,args,false,null);
   vm('encounter',k('wild'),'SendEncounterRequest',n=>n.includes('<Niantic.Holoholo.Map.PokemonEncounterResponse>'));
   vm('capture',k('pokemon'),'TryCapture',n=>n.includes('<Holoholo.Rpc.CatchPokemonOutProto>'),['Niantic.Holoholo.Encounter.PokeballThrow','Holoholo.Rpc.ARPlusEncounterValuesProto']);
   m.manualUI=method(classes[VGP_NAMEPLATE],'SetPokemonUI','System.Void',['Niantic.Holoholo.Map.IMapPokemon','Niantic.Rpc.GameplayWeatherProto.Types.WeatherCondition'],false,[0xad84364,'ff8303d1fd7b08a9fc6f09a9fa670aa9f85f0ba9f6570ca9f44f0da9541a02f0']);
   vm('location',k('pokemon'),'get_Location','Niantic.LatLng');vm('id',k('wild'),'get_EncounterId','System.UInt64');vm('visible',k('wild'),'get_VisibleOnMap',BOOL);
   vm('maxItems',k('player'),'get_MaxItems',INT);vm('maxPokemon',k('player'),'get_MaxPokemon',INT);
   vm('itemCount',classes[IBAG],'GetItemCount',INT,[ITEM]);vm('totalItems',classes[IBAG],'GetTotalItems',INT);vm('pokemonCount',classes[BAG],'get_Count',INT);
   vm('active',k('place'),'get_IsActive',BOOL);vm('range',k('place'),'get_IsPlayerInRange',BOOL);vm('closed',k('place'),'get_IsClosed',BOOL);vm('cooling',k('place'),'get_IsCoolingDown',BOOL);
   vm('fort',k('place'),'get_FortData',VGP.fort);vm('cooldown',k('place'),'SetCooldownTime','System.Void',['System.Int64']);
   vm('ctor',k('request'),'.ctor','System.Void');const findIter=Memory.alloc(8);findIter.writePointer(ptr(0));
   for(let i=0;i<256;i++){const q=api.class_get_methods(classes[OBJ],findIter);if(q.isNull())break;if(text(api.method_get_name(q))==='FindObjectsOfType'&&!api.method_is_generic(q)&&api.method_get_param_count(q)===1&&typeName(api,api.method_get_param(q,0))==='System.Type'&&typeName(api,api.method_get_return_type(q))==='UnityEngine.Object[]'){m.findAll={method:q};break;}}
   if(!m.findAll)throw Error('vgp-find-objects');
   f.fortId=typed(k('fort'),'FortId',0x10,'System.String');f.fortLat=typed(k('fort'),'Latitude',0x20,'System.Double');f.fortLon=typed(k('fort'),'Longitude',0x28,'System.Double');
   f.id=typed(k('request'),'Id',0x10,'System.String');f.lat=typed(k('request'),'PlayerLatDegrees',0x18,'System.Double');f.lon=typed(k('request'),'PlayerLngDegrees',0x20,'System.Double');f.targetLat=typed(k('request'),'FortLatDegrees',0x28,'System.Double');f.targetLon=typed(k('request'),'FortLngDegrees',0x30,'System.Double');
   f.result=enumI32Field(classes[SPINRESULT],'Result',0x10);f.until=typed(classes[SPINRESULT],'CooldownComplete',0x38,'System.Int64');f.catchStatus=enumI32Field(classes[RESP],'Status',0x10);f.bagGm=typed(classes[BAG],'cypm',0x38,'IGameMasterData');
   const enumValue=(klass,name)=>{const q=api.class_get_field_from_name(klass,Memory.allocUtf8String(name)),b=Memory.alloc(4);if(q.isNull()||(api.field_get_flags(q)&0x8050)!==0x8050)throw Error('vgp-enum:'+name);api.field_static_get_value(q,b);return b.readS32();};
   const spinSuccess=enumValue(api.class_from_type(api.field_get_type(f.result)),'Success'),rpcId=enumValue(k('method'),'FortSearch');
   const catchStates={};for(const name of ['CatchSuccess','CatchEscape','CatchFlee','CatchMissed','CatchError','CatchItemReplacement'])catchStates[name]=enumValue(api.class_from_type(api.field_get_type(f.catchStatus)),name);
   const native=(name,ret,args)=>{const a=module.findExportByName('il2cpp_'+name);if(!a)throw Error('vgp-export:'+name);return new NativeFunction(a,ret,args,{scheduling:'exclusive',exceptions:'propagate'});};
   vgp={m,f,spinSuccess,rpcId,catchStates,parent:native('class_get_parent','pointer',['pointer']),array:native('array_new','pointer',['pointer','uint64']),barrier:native('gc_wbarrier_set_field','void',['pointer','pointer','pointer']),unreflect:native('method_get_from_reflection','pointer',['pointer'])};
  }catch(e){vgp=null;vgpError=String(e);}
  let mapPoi=null,mapPoiError=null;
  try {
   if(!vgp)throw Error('map-dependencies');
   const gym=classes['Niantic.Holoholo.Gym.MapGym'],raid=classes['Holoholo.Rpc.RaidInfoProto'];
   if(!gym||!raid)throw Error('map-classes');
   const field=(owner,name,types)=>{const f=api.class_get_field_from_name(owner,Memory.allocUtf8String(name));if(f.isNull()||(api.field_get_flags(f)&16)||!types.includes(typeName(api,api.field_get_type(f))))throw Error('map-field:'+name);return f;};
   mapPoi={gym,raid,info:field(classes[VGP.fort],'RaidInfo',['Holoholo.Rpc.RaidInfoProto']),end:field(raid,'RaidEndMs',['System.Int64','System.UInt64']),spawn:field(raid,'RaidSpawnMs',['System.Int64','System.UInt64']),battle:field(raid,'RaidBattleMs',['System.Int64','System.UInt64']),hidden:field(raid,'IsRaidHidden',[BOOL])};
   // Optional enrichment (raid tier/boss, gym team/slots). Any failure here degrades to the basic
   // marker set instead of disabling every POI, and enum text is resolved from the game's own static
   // constants rather than a guessed numeric mapping. Values are read non-static with the same field()
   // name/type/non-static validation as the core fields.
   try{
    const enumMap=(klass)=>{
     if(klass.isNull()||!api.class_is_enum(klass)||typeName(api,api.class_enum_basetype(klass))!=='System.Int32')throw Error('enum-basetype');
     const nextField=new NativeFunction(module.findExportByName('il2cpp_class_get_fields'),'pointer',['pointer','pointer'],{scheduling:'exclusive',exceptions:'propagate'});
     const fieldName=new NativeFunction(module.findExportByName('il2cpp_field_get_name'),'pointer',['pointer'],{scheduling:'exclusive',exceptions:'propagate'});
     const it=Memory.alloc(8);it.writePointer(ptr(0));const v=Memory.alloc(4);const map={};
     for(let i=0;i<4096;i++){const f=nextField(klass,it);if(f.isNull())break;if((api.field_get_flags(f)&0x8050)!==0x8050)continue;api.field_static_get_value(f,v);map[v.readS32()]=text(fieldName(f));}
     return map;
    };
    mapPoi.level=field(raid,'RaidLevel',['Holoholo.Rpc.RaidLevel']);
    mapPoi.raidTiers=enumMap(api.class_from_type(api.field_get_type(mapPoi.level)));
    const pk=classes['Holoholo.Rpc.PokemonProto'];
    if(pk){mapPoi.bossClass=pk;mapPoi.boss=field(raid,'RaidPokemon',['Holoholo.Rpc.PokemonProto']);mapPoi.bossId=field(pk,'pokemonId_',['System.Int32']);}
    mapPoi.teamMethod=method(gym,'get_GymDisplayTeam','Niantic.Holoholo.Team',[],false,null);
    mapPoi.teamNames=enumMap(api.class_from_type(api.method_get_return_type(mapPoi.teamMethod.method)));
    const gd=classes['Holoholo.Rpc.GymDisplayProto'];
    if(gd){mapPoi.gymDisplayClass=gd;mapPoi.gymDisplay=field(classes[VGP.fort],'GymDisplay',['Holoholo.Rpc.GymDisplayProto']);mapPoi.slots=field(gd,'SlotsAvailable',['System.Int32']);}
   }catch(e){mapPoi.extraError=String(e);}
  }catch(e){mapPoiError=String(e);}
  // Projection is optional: the activity pill still works if camera metadata differs.
  if(vgp)try{vgp.marker={camera:method(classes[VGP.camera],'get_main',VGP.camera,[],true,null),transform:method(classes['UnityEngine.Component'],'get_transform','UnityEngine.Transform',[],false,null),position:method(classes['UnityEngine.Transform'],'get_position','UnityEngine.Vector3',[],false,null),project:method(classes[VGP.camera],'WorldToScreenPoint','UnityEngine.Vector3',['UnityEngine.Vector3'],false,null),width:method(classes[VGP.screen],'get_width',INT,[],true,null),height:method(classes[VGP.screen],'get_height',INT,[],true,null)};}catch(e){vgp.markerError=String(e);}


  return{directPresentation,directPresentationError,catchScene,catchSceneError,catchDiscovery,catchDiscoveryError,catchCanvas,catchCanvasError,incubator,incubatorError,mapPoi,mapPoiError,vgp,vgpError,buddy,buddyError,gifts,giftsError,spawn,spawnError,module,api,classes,fields,fieldMeta,methods,success,caughtIdSize:caughtId.size,details,detailsError,transfer,transferError,spin,spinError,spinCamera,spinCameraError,items,itemsError,rocket,rocketError,battles,battlesError,berries,berriesError};

 }finally{if(owned&&!owned.isNull())api.thread_detach(owned);}

}

function event(s,kind,fields){if(s.queue.length>=LIMITS.queue){fault(s,Error('queue-limit'));return false;}let time=null;try{time=s.now();}catch(_){}s.queue.push(Object.assign({kind,boottimeMs:time},fields||{}));return true;}

function fault(s,error){s.allowedUntil=0;s.stopping=true;s.reason=s.reason||String(error).slice(0,180);if(error&&error.stack)event(s,'fault-detail',{stack:String(error.stack).slice(0,2000)});}

function flush(s){for(const e of s.queue.splice(0)){try{console.log('[pgrazor-quick-close] '+JSON.stringify(e));}catch(_){}if(typeof s.onEvent==='function')try{s.onEvent(e);}catch(_){}}}

// Pure decision policy: no missing or malformed classification may authorize a transfer.

function transferKeepSet(raw){
 if(typeof raw!=='string'||raw.length>10000)return null;
 const ids=new Set();if(raw==='')return ids;
 for(const part of raw.split(',')){if(!/^[1-9][0-9]{0,3}$/.test(part))return null;const id=Number(part);if(id>2000||ids.has(id))return null;ids.add(id);}
 return ids.size<=2000?ids:null;
}
function transferKeepReason(species,keepSpecies,keepAll){
 if(keepAll===true)return 'keep-all';
 if(keepSpecies===null)return 'invalid-keep-list';
 if(keepSpecies&&keepSpecies.size){if(!Number.isInteger(species)||species<1||species>2000)return 'unknown-species';if(keepSpecies.has(species))return 'custom-keep-list';}
 return null;
}
function transferDecision(v,protect=63,keepSpecies,keepAll=false){
 const keep=transferKeepReason(v&&v.species,keepSpecies,keepAll);if(keep)return keep;

 if(!v||![v.attack,v.defense,v.stamina].every(n=>Number.isInteger(n)&&n>=0&&n<=15))return 'unknown-iv';

 if(['rare','shiny','event','background','favorite','egg'].some(k=>typeof v[k]!=='boolean'))return 'unknown-category';

 if((protect&16)&&typeof v.xxs!=='boolean'||(protect&32)&&typeof v.xxl!=='boolean')return 'unknown-size';

 if(v.favorite||v.egg)return 'favorite-or-egg';

 if((v.attack+v.defense+v.stamina)*100>=90*45)return 'iv-at-least-90';

 for(const [key,bit]of [['rare',1],['shiny',2],['event',4],['background',8],['xxs',16],['xxl',32]])if((protect&bit)&&v[key])return 'protected-'+key;

 return null;

}

function install(s,p){

 const {api,classes,fields,methods}=p;
 const {read:vgpPromise,field:vgpField}=PGRazorFeatures.nativePromise({api,p,Memory,present,readPtr});
 const {itemInt,itemArgs,itemNumber}=PGRazorFeatures.itemValues({hold,invoke,target,exact,classes,INT,api,freeHandle,Memory});
 let presentationBridge=null;
 if(p.directPresentation&&p.details&&globalThis.PGRazorCatchPresentationBridge)try{
  const exp=n=>p.module.findExportByName('il2cpp_'+n);
  presentationBridge=globalThis.PGRazorCatchPresentationBridge.create({
   address:p.directPresentation.show.address,gchandle_new:exp('gchandle_new'),gchandle_free:exp('gchandle_free'),
   get_target:exp('gchandle_get_target'),object_get_class:exp('object_get_class'),
   gettid:Process.getModuleByName('libc.so').findExportByName('gettid'),view:classes[VIEW],action:classes[ACTION],pokemon:classes[PK]});
  s.listeners.push({detach(){presentationBridge.dispose();}});
  event(s,'direct-catch-bridge-ready',{});
 }catch(e){event(s,'direct-catch-bridge-unavailable',{reason:String(e)});}


 function exact(o,k){return !o.isNull()&&api.object_get_class(o).equals(k);}

 function hold(o){if(o.isNull())throw Error('null-managed-object');const h=api.gchandle_new(o,0);if(h.isNull())throw Error('gc-handle-new');s.ownedHandles.add(h);return h;}

 function target(h){const o=api.gchandle_get_target(h);if(o.isNull())throw Error('gc-target-null');return o;}

 function freeHandle(h){if(h&&s.ownedHandles.has(h)){api.gchandle_free(h);s.ownedHandles.delete(h);}}

 function readPtr(o,f){const out=Memory.alloc(8);out.writePointer(ptr(0));api.field_get_value(o,f,out);return out.readPointer();}

 function readS32(o,f){const out=Memory.alloc(4);out.writeS32(0);api.field_get_value(o,f,out);return out.readS32();}

 function present(o,f,size){const out=Memory.alloc(8);out.writeU64(0);api.field_get_value(o,f,out);for(let i=0;i<size;i++)if(out.add(i).readU8()!==0)return true;return false;}

 function capturedKey(o,f=fields.caughtId){const out=Memory.alloc(8);out.writeU64(0);api.field_get_value(o,f,out);return Array.from({length:8},(_,i)=>out.add(i).readU8()).join(',');}

 function invoke(m,o,args){const ex=Memory.alloc(8);ex.writePointer(ptr(0));const r=api.runtime_invoke(m,o,args||ptr(0),ex);if(!ex.readPointer().isNull())throw Error('managed-exception:'+text(api.method_get_name(m))+':'+typeName(api,api.class_get_type(api.object_get_class(ex.readPointer()))));return r;}

 function alive(o){const args=Memory.alloc(8);args.writePointer(o);const h=hold(invoke(methods.alive.method,ptr(0),args));

  try{const b=target(h);if(!exact(b,classes[BOOL]))throw Error('boxed-class');const v=api.object_unbox(b);if(v.isNull())throw Error('boxed-null');const n=v.readU8();if(n>1)throw Error('invalid-bool');return n===1;}finally{freeHandle(h);}}

 function unity(tid){return s.thread!==null&&s.matches>=3&&tid===s.thread&&!api.thread_current().isNull();}

 // Optional native Routes module. Isolated: any failure here must not disturb
 // the catch/transfer/spin pipeline above. It reuses the host's verified
 // Unity-thread tick and GC-root helpers and owns only Route service objects.
 try{
  if(globalThis.PGRazorRoutes&&typeof globalThis.PGRazorRoutes.createController==='function'){
   s.routes=globalThis.PGRazorRoutes.createController({api,module:p.module,Memory,ptr,Interceptor,NativeFunction,Process,executable,
    event:(kind,fields)=>event(s,kind,fields),now:()=>s.now(),
    hold,target,freeHandle,invoke,exact,readPtr,unity,
    addListener:l=>s.listeners.push(l),isStopping:()=>s.stopping});
   event(s,'routes-module-installed',{version:s.routes.version});
  }else event(s,'routes-module-absent',{});
 }catch(e){s.routes=null;event(s,'routes-module-unavailable',{reason:String(e)});}

 function releaseRecord(r){restoreCatchCanvas(r);for(const k of['gui','state','response','proto','dismissed','data','pokemon','service','transferBag','transferPromise','vgpBag','vgpGm']){if(r[k]){try{freeHandle(r[k]);}catch(e){fault(s,e);}r[k]=null;}}}

 try { s.adventureSync=PGRazorAdventureSync.create({api,module:p.module,Memory,ptr,Interceptor,
  now:()=>s.now(),hold,target,freeHandle,invoke,exact,unity,
  event:(kind,fields)=>event(s,kind,fields),addListener:l=>s.listeners.push(l)}); }
 catch(e){event(s,'adventure-sync-native-unavailable',{reason:String(e)});}

 // A confirmed post-catch details panel may stay invisible while normal opening,
 // transfer and dismissal run. Only the canvas changes; transitions/state stay native.
 function catchCanvasAllowed(r){return !!p.catchCanvas&&s.dismissEnabled&&!s.stopping&&r.epoch===s.epoch&&!r.cancelled&&!r.invoked&&s.allowedUntil!==0&&s.now()<s.allowedUntil;}
 function setCatchCanvas(gui,visible){const value=Memory.alloc(1),args=Memory.alloc(8);value.writeU8(visible?1:0);args.writePointer(value);invoke(p.catchCanvas.method,gui,args);}
 function restoreCatchCanvas(r){if(!r.canvasHidden)return;r.canvasHidden=false;
  try{const gui=target(r.gui);if(alive(gui)&&readS32(gui,fields.currentState)===STATE_OPEN)setCatchCanvas(gui,true);}
  catch(e){event(s,'catch-canvas-restore-error',{reason:String(e)});}
 }
 function directCatchValid(r){try{const d=p.directPresentation,f=p.details.fields;
  if(!d||!r.direct||!r.state||!r.response||!r.pokemon||!r.dismissed)return false;
  const st=target(r.state),response=target(r.response),pk=target(r.pokemon),callback=target(r.dismissed);
  if(!exact(st,classes[VIEW])||!exact(response,classes[RESP])||!exact(pk,classes[PK])||!exact(callback,classes[ACTION]))return false;
  const active=Memory.alloc(1);api.field_get_value(st,d.active,active);
  return active.readU8()===1&&readPtr(callback,f.delegateTarget).equals(st)&&readPtr(st,f.viewResponse).equals(response)&&readS32(response,fields.status)===p.success&&capturedKey(response)===r.capturedKey&&capturedKey(pk,f.id)===r.capturedKey;
 }catch(_){return false;}}
 function replayDirectPresentation(r,flags){const t=p.directPresentation,args=Memory.alloc(10*8);
  const values=[target(r.pokemon),flags[0],flags[1],flags[2],target(r.dismissed),ptr(0),ptr(0),flags[3],flags[4],flags[5]];
  // Ten declared parameters; reference args contain the object pointer itself.
  for(let i=0;i<values.length;i++){if([0,4,5,6].includes(i))args.add(i*8).writePointer(values[i]);else{const v=Memory.alloc(4);v.writeS32(values[i]);args.add(i*8).writePointer(v);}}
  invoke(t.show.method,target(r.service),args);
  event(s,'direct-catch-fallback',{});
 }
 function completeDirectPresentation(capture,normalDismissed){if(!capture)return false;
  let r=null,completed=false;
  try{const [service,pokemon,dismissed]=capture.handles;for(const h of capture.handles)s.ownedHandles.add(h);
   r={direct:true,kind:'direct',epoch:s.epoch,service,pokemon,dismissed};
   const pending=s.pendingDetails;if(!pending){replayDirectPresentation(r,capture.flags);return false;}
   const state=readPtr(target(dismissed),p.details.fields.delegateTarget);
   r.state=hold(state);r.response=hold(target(pending.response));r.capturedKey=pending.capturedKey;
   if(!normalDismissed||!s.dismissEnabled||s.stopping||s.allowedUntil===0||s.now()>=s.allowedUntil||!directCatchValid(r)){
    replayDirectPresentation(r,capture.flags);return false;
   }
   // Same inventory identity checks, IV/rarity protections, RPC and confirmation
   // tracking as normal details. VGP does not enter this bridge or branch.
   transferCatch(r,s.thread);
   if(!directCatchValid(r))throw Error('direct-state-changed');
   invoke(p.directPresentation.callback.method,target(r.dismissed));
   completed=true;releasePendingDetails();event(s,'direct-catch-returned',{});return true;
  }catch(e){event(s,'direct-catch-error',{reason:String(e)});
   // A partially completed callback must never be invoked twice. Replay the
   // ordinary screen only when the same confirmed view state is still active.
   if(r&&directCatchValid(r))try{replayDirectPresentation(r,capture.flags);}catch(f){event(s,'direct-catch-fallback-error',{reason:String(f)});}
   return completed;
  }finally{if(r)releaseRecord(r);else for(const h of capture.handles)freeHandle(h);}
 }

 function hideOpeningDetails(r){if(!catchCanvasAllowed(r)||r.kind!=='details'||!r.initDone||!detailsValid(r))return;
  try{const gui=target(r.gui);if(!alive(gui))return;r.canvasHidden=true;setCatchCanvas(gui,false);}
  catch(e){restoreCatchCanvas(r);event(s,'catch-canvas-hide-error',{reason:String(e)});}
 }
 if(p.catchCanvas)s.listeners.push(Interceptor.attach(p.catchCanvas.address,{onEnter(args){
  try{if(!unity(this.threadId)||s.stopping||!s.dismissEnabled)return;
   // Ownership/identity was established outside this hook. Do not invoke any
   // managed recovery or list methods from the visibility callback.
   const r=findByGui(args[0]);
   if(!r||!r.canvasHidden||!catchCanvasAllowed(r)||r.kind!=='details'||!r.initDone)return;
   args[1]=ptr(0);
  }catch(e){event(s,'catch-canvas-hook-error',{reason:String(e)});}
 }}));

 // Only hide after normal dismissal has demonstrably advanced the GUI. A
 // rejected/failed dismissal stays visible, and no native callback is invoked twice.
 function hideDismissedCatch(gui,r,after,gone,error){
  if(!p.catchCanvas||!s.dismissEnabled||s.stopping||r.epoch!==s.epoch||s.allowedUntil===0||s.now()>=s.allowedUntil||error||gone||after===null||after===STATE_OPEN)return;
  try{if(!alive(gui))return;const value=Memory.alloc(1),args=Memory.alloc(8);value.writeU8(0);args.writePointer(value);
   invoke(p.catchCanvas.method,gui,args);event(s,'catch-dismissed-hidden',{screen:r.kind==='details'?'details':'summary'});
  }catch(e){event(s,'catch-dismissed-hide-error',{reason:String(e)});}
 }

 function findByGui(o){for(const r of s.records){if(!r.gui)continue;try{if(target(r.gui).equals(o))return r;}catch(_){}}return null;}

 function recordForGui(o,now){let r=findByGui(o);if(r)return r;

  if(s.records.length>=LIMITS.maxRecords){const i=s.records.findIndex(x=>!x.invoked);if(i<0)return null;event(s,'candidate-cancelled',{reason:'record-overflow',tid:s.thread});releaseRecord(s.records[i]);s.records.splice(i,1);}

  r={gui:hold(o),state:null,response:null,proto:null,dismissed:null,epoch:s.epoch,initDone:false,setScoresDone:false,openCompleteDone:false,success:false,capturedId:false,invoked:false,cancelled:null,readyMatch:null,createdMs:now,deadline:now+LIMITS.timeoutMs};

  s.records.push(r);return r;}

 function cancel(r,reason){if(r.cancelled)return;r.cancelled=reason;event(s,'candidate-cancelled',{reason,tid:s.thread});}

 function releasePendingDetails(){if(s.pendingDetails){freeHandle(s.pendingDetails.layer);freeHandle(s.pendingDetails.response);s.pendingDetails=null;}}

 function prune(now){if(s.pendingDetails&&(s.stopping||s.pendingDetails.epoch!==s.epoch||s.allowedUntil===0||now>=s.allowedUntil||now>=s.pendingDetails.deadline))releasePendingDetails();for(let i=0;i<s.records.length;){const r=s.records[i];let drop=r.cancelled||r.invoked;let reason=r.cancelled;

   if(!drop){if(r.epoch!==s.epoch){reason='permission-revoked';drop=true;}else if(s.stopping){reason='stop';drop=true;}else if(s.allowedUntil===0){reason='off';drop=true;}else if(now>=s.allowedUntil){reason='lease-expired';drop=true;}else if(now>=r.deadline){reason='timeout';drop=true;}}

   if(drop){if(reason&&!r.cancelled&&!r.invoked)event(s,'candidate-cancelled',{reason,tid:s.thread});releaseRecord(r);s.records.splice(i,1);}else i++;}}

 function cleanupTick(tid){if(s.busy)return;s.busy=true;

  try{if(!unity(tid))return;let now;try{now=s.now();}catch(e){fault(s,e);for(const r of s.records.splice(0))releaseRecord(r);if(s.openerDepth===0)for(const h of s.ownedHandles){try{freeHandle(h);}catch(e){fault(s,e);}}return;}

   giftTick(now);

   buddyTick(now);

   incubatorTick(now);

   berryTick(now);

   battleTick(now);

   rocketMiniTick(now);

   rocketTick(now);

   itemTick(now);

   mapPoiTick(now);
   vgpTick(now);

   transferTick(now);

   spinTick(now,tid);

   pruneSpinCameras(now);

   if(s.adventureSync)try{s.adventureSync.tick(now,tid);}catch(e){event(s,"adventure-sync-native-error",{reason:String(e)});}
   if(s.routes)try{s.routes.tick(now,tid);}catch(e){event(s,'routes-tick-error',{reason:String(e)});}

   for(const r of s.records)if(r.canvasHidden&&!catchCanvasAllowed(r))restoreCatchCanvas(r);
   prune(now);
   discoverCatchDetails();

   if(s.stopping&&s.openerDepth===0){for(const h of s.ownedHandles){try{freeHandle(h);}catch(e){fault(s,e);}}}

   if(s.stopping||s.allowedUntil===0||now>=s.allowedUntil||s.openerDepth!==0)return;

   const r=s.records.find(x=>!x.invoked&&!x.cancelled&&(x.kind==='details'?x.initDone&&x.presentDone&&x.openCompleteDone:x.initDone&&x.setScoresDone&&x.openCompleteDone&&x.success&&x.capturedId));

   if(!r)return;

   // Require a strictly later proven Unity tick than the one that first saw the

   // candidate ready, so the opener/init frame has fully unwound before invoking.

   if(r.readyMatch===null){r.readyMatch=s.matches;event(s,'candidate-armed',{tid});return;}

   if(s.matches<=r.readyMatch)return;

   if(r.kind==='details'){dismissDetails(r,tid);return;}

   const gui=target(r.gui);

   if(!exact(gui,classes[SGUI])){cancel(r,'gui-class-mismatch');return;}

   if(!alive(gui)){cancel(r,'gui-destroyed');return;}

   if(r.state){const st=target(r.state);if(!exact(st,classes[SSTATE])){cancel(r,'state-class-mismatch');return;}if(!readPtr(st,fields.dscx).equals(gui)){cancel(r,'state-gui-mismatch');return;}

    if(!readPtr(st,fields.dscy).equals(target(r.proto))||!target(r.response).equals(target(r.proto))||readS32(target(r.proto),fields.status)!==p.success||capturedKey(target(r.proto))!==r.capturedKey){cancel(r,'response-mismatch');return;}}

   const before=readS32(gui,fields.currentState);

   if(before!==STATE_OPEN){cancel(r,'state-not-open:'+before);return;}

   if(readPtr(gui,fields.onDismissed).isNull()){cancel(r,'ondismissed-null');return;}

   if(!r.dismissed||!readPtr(gui,fields.onDismissed).equals(target(r.dismissed))){cancel(r,'ondismissed-mismatch');return;}

   if(s.stopping||r.cancelled||s.allowedUntil===0||s.now()>=s.allowedUntil||r.epoch!==s.epoch||s.openerDepth!==0){cancel(r,'permission-revoked');return;}

   // Invoke the normal inherited GuiController.Dismiss once, on this Unity thread.

   // r.invoked is set first so a suppressed/throwing invoke can never run twice.

   if(p.details){releasePendingDetails();s.pendingDetails={response:hold(target(r.proto)),capturedKey:r.capturedKey,epoch:s.epoch,deadline:s.now()+LIMITS.timeoutMs,returned:false};if(p.catchDiscovery)try{const layer=readPtr(gui,p.catchDiscovery.layer);if(exact(layer,p.catchDiscovery.klass))s.pendingDetails.layer=hold(layer);}catch(e){event(s,'details-discovery-unavailable',{reason:String(e)});}}

   r.invoked=true;s.invoking=true;s.invokingGui=gui;let threw=null,capture=null,bridgeOpen=false;
   if(presentationBridge&&s.dismissEnabled&&s.pendingDetails&&unity(tid))try{
    presentationBridge.begin(target(s.pendingDetails.response),tid);bridgeOpen=true;
   }catch(e){event(s,'direct-catch-window-error',{reason:String(e)});}
   try{invoke(methods.dismiss.method,gui,ptr(0));}catch(e){threw=String(e).slice(0,140);}finally{
    if(bridgeOpen)try{const c=presentationBridge.end();if(c)capture={handles:[c.service,c.pokemon,c.callback],flags:[+c.confirm,+c.persist,c.openHyperTraining,+c.hideAr,+c.post,+c.suppress]};}
    catch(e){event(s,'direct-catch-window-error',{reason:String(e)});}
    s.invoking=false;s.invokingGui=null;
   }

   // Verify the postcondition directly (the hook may be suppressed under nesting):

   // currentState must have advanced off 2, or the GUI must be gone.

   let after=null,gone=false;

   try{if(exact(gui,classes[SGUI])&&alive(gui))after=readS32(gui,fields.currentState);else gone=true;}catch(_){after=null;}

   completeDirectPresentation(capture,!threw&&(gone||(after!==null&&after!==STATE_OPEN)));

   if(s.pendingDetails){if(!threw&&(gone||(after!==null&&after!==STATE_OPEN))){s.pendingDetails.returned=true;discoverCatchDetails();}else releasePendingDetails();}

   hideDismissedCatch(gui,r,after,gone,threw);

   event(s,'summary-dismiss-invoked',{tid,stateBefore:before,stateAfter:after,guiGone:gone,error:threw,advanced:gone||(after!==null&&after!==STATE_OPEN)});

   releaseRecord(r);const idx=s.records.indexOf(r);if(idx>=0)s.records.splice(idx,1);

  }catch(e){fault(s,e);}finally{s.busy=false;}}

 // ---- opener/initialization hooks: observe completion, never re-enter dismissal ----

 let windowStart=s.now(),hits=0;

 function openHook(address,handler){s.listeners.push(Interceptor.attach(address,{

  onEnter(args){s.openerDepth++;this.active=true;this.payload=null;

   try{if(!s.active||s.stopping||!unity(this.threadId)||s.allowedUntil===0||s.now()>=s.allowedUntil)return;

    const now=s.now();if(now-windowStart>=1000){windowStart=now;hits=0;}if(++hits>LIMITS.hitsPerSecond)throw Error('hook-rate-limit');

    this.epoch=s.epoch;this.payload=handler.onEnter?handler.onEnter(args,this.threadId):{};

   }catch(e){fault(s,e);}},

  onLeave(){if(this.active){s.openerDepth--;this.active=false;}const payload=this.payload;this.payload=null;if(!payload)return;

   const wasBusy=s.busy;s.busy=true;try{if(!s.stopping&&this.epoch===s.epoch&&s.allowedUntil!==0&&s.now()<s.allowedUntil&&unity(this.threadId))handler.onLeave(payload,this.threadId);}catch(e){fault(s,e);}finally{try{handler.release&&handler.release(payload);}catch(e){fault(s,e);}s.busy=wasBusy;}}}));}

 // SummaryState.Initialize(response): both Initialize and (its internal) SetScores

 // have returned at leave; capture state/response identity and confirmed success.

 openHook(methods.initialize.address,{

  onEnter(args){for(const r of s.records)cancel(r,'new-initialization');

   const state=exact(args[0],classes[SSTATE])?hold(args[0]):null;if(!state)return null;

   try{const proto=!args[1].isNull()&&exact(args[1],classes[RESP])?hold(args[1]):null;return{state,proto};}catch(e){freeHandle(state);throw e;}},

  onLeave(payload,tid){const state=target(payload.state);

   const success=payload.proto?readS32(target(payload.proto),fields.status)===p.success:false;

   if(!success){event(s,'candidate-skipped',{reason:'not-confirmed-success',tid});return;}

   const gui=readPtr(state,fields.dscx);if(!exact(gui,classes[SGUI])){event(s,'candidate-skipped',{reason:'no-summary-gui',tid});return;}

   const now=s.now(),r=recordForGui(gui,now);if(!r)return;

   if(r.cancelled)return;

   if(r.state)freeHandle(r.state);r.state=payload.state;payload.state=null;

   if(payload.proto){if(r.proto)freeHandle(r.proto);r.proto=payload.proto;payload.proto=null;}

   const response=readPtr(state,fields.dscy),responseMatched=exact(response,classes[RESP])&&response.equals(target(r.proto));

   // SetScores owns r.response; never replace its evidence with Initialize's argument.

   if(!responseMatched||(r.response&&!target(r.response).equals(target(r.proto)))){cancel(r,'response-mismatch');return;}

   const dismissed=readPtr(gui,fields.onDismissed);if(!dismissed.isNull())r.dismissed=hold(dismissed);

   const capturedId=present(target(r.proto),fields.caughtId,p.caughtIdSize);

   r.initDone=true;r.success=true;r.capturedId=capturedId;r.capturedKey=capturedKey(target(r.proto));r.readyMatch=null;

   event(s,'candidate-initialized',{tid,capturedId,responseMatched});},

  release(payload){freeHandle(payload.state);freeHandle(payload.proto);}});

 // SummaryGui.SetScores(response,berry): XP/token fields are now populated.

 openHook(methods.setScores.address,{

  onEnter(args){if(!exact(args[0],classes[SGUI])||!exact(args[1],classes[RESP]))return null;const gui=hold(args[0]);try{return{gui,response:hold(args[1])};}catch(e){freeHandle(gui);throw e;}},

  onLeave(payload,tid){const now=s.now(),r=recordForGui(target(payload.gui),now);if(!r||r.cancelled)return;

   if(r.response)freeHandle(r.response);r.response=payload.response;payload.response=null;

   if(r.proto&&!target(r.proto).equals(target(r.response))){cancel(r,'response-mismatch');return;}

   r.setScoresDone=true;r.readyMatch=null;event(s,'candidate-progress',{stage:'set-scores',tid});},

  release(payload){freeHandle(payload.gui);freeHandle(payload.response);}});

 // SummaryGui.HandleOpenComplete(): the opener wrote currentState=2 and tail-called

 // this; its return means the open transition finished for this GUI.

 openHook(methods.handleOpenComplete.address,{

  onEnter(args){return exact(args[0],classes[SGUI])?{gui:hold(args[0])}:null;},

  onLeave(payload,tid){const now=s.now(),r=recordForGui(target(payload.gui),now);if(!r)return;r.openCompleteDone=true;r.readyMatch=null;event(s,'candidate-progress',{stage:'open-complete',tid});},

  release(payload){freeHandle(payload.gui);}});

 // GuiController.Dismiss(): detect a natural/user dismissal of a tracked summary and

 // cancel our queued auto-close. Our own invoke is identified and ignored here.

 s.listeners.push(Interceptor.attach(methods.dismiss.address,{onEnter(args){

  try{if(!s.active)return;if(s.invoking&&s.invokingGui&&args[0].equals(s.invokingGui))return;if(!unity(this.threadId))return;

   const r=findByGui(args[0]);if(r&&!r.invoked&&!r.cancelled)cancel(r,'user-dismiss');

  }catch(e){fault(s,e);}}}));

 // State exit revokes queued work before the game starts teardown.

 s.listeners.push(Interceptor.attach(methods.exitState.address,{onEnter(args){try{

  if(!s.active||!unity(this.threadId))return;

  for(const r of s.records)if(r.state&&target(r.state).equals(args[0]))cancel(r,'state-exit');

 }catch(e){fault(s,e);}}}));

 // Details are tracked only while the encounter's own buji builds its screen.

 // Inventory Initialize calls cannot create candidates. The normal click handler

 // preserves special encounter return handling and all GUI/service cleanup.

 const detailFrames=[];

 function detailsValid(r){const d=p.details,f=d.fields;

  const gui=target(r.gui),st=target(r.state),response=target(r.response),data=target(r.data),pokemon=target(r.pokemon);

  if(!exact(gui,classes[DGUI])||!exact(st,classes[VIEW])||!exact(response,classes[RESP])||!exact(data,classes[DATA])||!exact(pokemon,classes[PK]))return false;

  if(!readPtr(st,f.viewResponse).equals(response)||readS32(response,fields.status)!==p.success||capturedKey(response)!==r.capturedKey||capturedKey(pokemon,f.id)!==r.capturedKey)return false;

  if(!exact(target(r.dismissed),classes[ACTION])||!readPtr(target(r.dismissed),f.delegateTarget).equals(st))return false;

  if(!readPtr(gui,f.data).equals(data)||!readPtr(gui,f.callback).equals(target(r.dismissed))||!readPtr(data,f.onDismissed).equals(target(r.dismissed)))return false;

  const flag=Memory.alloc(1);api.field_get_value(data,f.post,flag);if(flag.readU8()!==1||readS32(data,f.index)!==0)return false;

  const list=readPtr(data,f.list);if(!exact(list,d.listClass))return false;

  let count=null,item=null;

  try{count=hold(invoke(d.methods.count.method,list));const boxed=target(count);if(!exact(boxed,classes[INT])||api.object_unbox(boxed).readS32()!==1)return false;

   const index=Memory.alloc(4);index.writeS32(0);const args=Memory.alloc(8);args.writePointer(index);

   item=hold(invoke(d.methods.item.method,list,args));return target(item).equals(pokemon);

  }finally{freeHandle(count);freeHandle(item);}

 }

 // An existing species can build details synchronously inside our summary Dismiss.

 // Those nested hooks are suppressed. The later real open-complete callback can

 // recover ONLY the screen carrying the retained successful response, exact view

 // delegate and captured Pokemon. No inventory or unrelated GUI is eligible.

 // Recover synchronously from the game's registry, before the newly created
 // details GUI has rendered. Its response/delegate/Pokemon still must all match.
 function discoverCatchDetails(){const pending=s.pendingDetails,d=p.catchDiscovery;
  if(!pending||!pending.returned||s.invoking||!s.dismissEnabled||s.stopping||pending.epoch!==s.epoch||s.allowedUntil===0||s.now()>=s.allowedUntil||s.now()>=pending.deadline)return;
  const roots=[];const root=o=>{const h=hold(o);roots.push(h);return target(h);};
  const consider=gui=>{if(!exact(gui,classes[DGUI]))return false;const r=findByGui(gui)||recoverDetails(gui);if(!r)return false;
   hideOpeningDetails(r);event(s,'details-discovered-before-open-complete',{hidden:!!r.canvasHidden,state:readS32(gui,fields.currentState)});return true;};
  try{
   if(d&&pending.layer){const value=invoke(d.top.method,target(pending.layer));if(!value.isNull()&&consider(root(value)))return;}
   // TopGui excludes some opening screens. Find the actual component, then use
   // the same response/delegate/caught-ID checks. Bound scans to the catch window.
   const now=s.now(),t=p.catchScene;if(!t||(pending.sceneNext&&now<pending.sceneNext)||(pending.sceneScans||0)>=20)return;
   pending.sceneNext=now+50;pending.sceneScans=(pending.sceneScans||0)+1;
   const type=root(t.typeObject(api.class_get_type(classes[DGUI]))),args=Memory.alloc(8);args.writePointer(type);
   const array=root(invoke(t.find,ptr(0),args));const count=Number(t.length(array));
   if(!Number.isSafeInteger(count)||count<0||count>16)throw Error('catch-scene-count');
   if(pending.sceneScans===1)event(s,'details-scene-scan',{count});
   for(let i=0;i<count;i++){const gui=array.add(32+i*8).readPointer();if(!gui.isNull()&&consider(root(gui)))return;}
  }catch(e){event(s,'details-discovery-error',{reason:String(e)});}finally{for(const h of roots)freeHandle(h);}
 }

 function recoverDetails(gui){const pending=s.pendingDetails,d=p.details;

  if(!pending||!pending.returned||s.invoking||pending.epoch!==s.epoch||s.now()>=pending.deadline||!exact(gui,classes[DGUI]))return null;

  const f=d.fields,data=readPtr(gui,f.data);if(!exact(data,classes[DATA]))return null;

  const cb=readPtr(data,f.onDismissed);if(!exact(cb,classes[ACTION])||!readPtr(gui,f.callback).equals(cb))return null;

  const state=readPtr(cb,f.delegateTarget);if(!exact(state,classes[VIEW]))return null;

  const response=readPtr(state,f.viewResponse);if(!response.equals(target(pending.response))||readS32(response,fields.status)!==p.success||capturedKey(response)!==pending.capturedKey)return null;

  const list=readPtr(data,f.list);if(!exact(list,d.listClass)||readS32(data,f.index)!==0)return null;

  const r={kind:'details',epoch:s.epoch,deadline:pending.deadline,readyMatch:null,initDone:true,presentDone:true,openCompleteDone:false,invoked:false,cancelled:null,capturedKey:pending.capturedKey};

  s.records.push(r);r.gui=hold(gui);r.data=hold(data);r.dismissed=hold(cb);r.state=hold(state);r.response=hold(response);

  const index=Memory.alloc(4);index.writeS32(0);const args=Memory.alloc(8);args.writePointer(index);r.pokemon=hold(invoke(d.methods.item.method,list,args));

  if(!detailsValid(r)){cancel(r,'recovered-details-identity-mismatch');return null;}

  releasePendingDetails();event(s,'details-recovered-after-summary',{tid:s.thread});return r;

 }

 function finishTransfer(key,success,reason){const pending=s.transferPending.get(key);if(!pending)return;

  s.transferPending.delete(key);pending.record.transferComplete=success;pending.record.transferFailed=!success;

  freeHandle(pending.bag);freeHandle(pending.pokemon);

  event(s,success?'transfer-confirmed':'transfer-error',{capturedKey:key,reason:reason||null,tid:s.thread});

 }

 function transferTick(now){for(const[key,x]of s.transferPending){

  if(s.stopping||x.epoch!==s.epoch||!s.transferEnabled||now>=s.allowedUntil){freeHandle(x.bag);freeHandle(x.pokemon);s.transferPending.delete(key);}

  else if(now>=x.deadline)finishTransfer(key,false,'response-timeout');

 }}

 if(p.transfer){const t=p.transfer;

  function matchTransfer(args){if(!unity(this.threadId)||s.stopping||!s.transferEnabled||s.now()>=s.allowedUntil||!exact(args[0],t.callbackClass))return null;

   const pk=readPtr(args[0],t.fields.callbackPokemon);if(!exact(pk,classes[PK]))return null;

   const key=capturedKey(pk,p.details.fields.id),x=s.transferPending.get(key);

   if(!x||x.epoch!==s.epoch||!target(x.pokemon).equals(pk)||!readPtr(args[0],t.fields.callbackBag).equals(target(x.bag)))return null;

   return key;

  }

  s.listeners.push(Interceptor.attach(t.methods.result.address,{onEnter(args){try{this.key=matchTransfer.call(this,args);

   this.success=this.key!==null&&exact(args[1],classes[RELEASE])&&readS32(args[1],t.fields.resultStatus)===t.resultSuccess;

  }catch(e){this.key=null;}},onLeave(){if(this.key!==null&&this.key!==undefined)finishTransfer(this.key,this.success,this.success?null:'server-result');}}));

  s.listeners.push(Interceptor.attach(t.methods.error.address,{onEnter(args){try{this.key=matchTransfer.call(this,args);}catch(e){this.key=null;}},onLeave(){if(this.key!==null&&this.key!==undefined)finishTransfer(this.key,false,'service-error');}}));

 }

 // Each camera iterator caches 1/animationTime in djjv on its first MoveNext.

 // Shorten only that fresh iterator: shared camera defaults, FOV and callbacks

 // remain untouched. Native final-position/OnComplete still execute normally.

 const spinCameras=new Map();

 function pruneSpinCameras(now){for(const [phase,r]of spinCameras)if(!spinPermitted()||r.epoch!==s.spinEpoch||now>=r.deadline){freeHandle(r.state);spinCameras.delete(phase);}}

 if(p.spinCamera){const c=p.spinCamera;

  for(const def of c.states){

   s.listeners.push(Interceptor.attach(def.enter.address,{onEnter(args){try{if(!unity(this.threadId)||!spinPermitted()||!exact(args[0],def.klass))return;const old=spinCameras.get(def.phase);if(old)freeHandle(old.state);spinCameras.set(def.phase,{state:hold(args[0]),def,epoch:s.spinEpoch,deadline:s.now()+15000});}catch(e){event(s,'spin-camera-error',{reason:String(e)});}}}));

   s.listeners.push(Interceptor.attach(def.exit.address,{onEnter(args){try{const r=spinCameras.get(def.phase);if(unity(this.threadId)&&r&&target(r.state).equals(args[0])){freeHandle(r.state);spinCameras.delete(def.phase);}}catch(_){}}}));

  }

  s.listeners.push(Interceptor.attach(c.move.address,{

   onEnter(args){try{if(!unity(this.threadId)||!spinPermitted()||!exact(args[0],c.iterator)||readS32(args[0],c.state)!==0)return;pruneSpinCameras(s.now());const camera=readPtr(args[0],c.owner);if(!exact(camera,classes[SPLINE]))return;

    for(const r of spinCameras.values())if(readPtr(target(r.state),r.def.camera).equals(camera)){this.cameraIterator=hold(args[0]);this.cameraEpoch=s.spinEpoch;this.cameraPhase=r.def.phase;break;}

   }catch(e){event(s,'spin-camera-error',{reason:String(e)});}},

   onLeave(ret){if(!this.cameraIterator)return;try{if(!spinPermitted()||this.cameraEpoch!==s.spinEpoch||ret.toInt32()!==1)return;const o=target(this.cameraIterator);if(readS32(o,c.state)!==1)return;const speed=o.add(0x50).readFloat();if(!Number.isFinite(speed)||speed<=0)return;o.add(0x50).writeFloat(Math.max(speed,25));event(s,'spin-camera-fast',{phase:this.cameraPhase,originalMs:1000/speed,targetMs:Math.min(1000/speed,40)});}catch(e){event(s,'spin-camera-error',{reason:String(e)});}finally{freeHandle(this.cameraIterator);}}

  }));

 }

 // Rocket scope is observed even while toggles are off, so enabling mid-battle works.

 const {rocketState,rocketBool,rocketTick,rocketMiniTick}=PGRazorFeatures.rocket({freeHandle,hold,invoke,target,exact,classes,BOOL,api,event,s,p,ROCKET,alive,readS32,fields,STATE_OPEN,readPtr,RDIR,typeName,RCHARGE,present,Memory,RMINI,RVGEST,Interceptor,unity,RVUI,RVCHARGE,RUI,RSHIELD});

 const {tick:incubatorTick}=PGRazorFeatures.incubation({s,p,api,classes,PK,BAG,VGP,Memory,uint64,ptr,invoke,itemArgs,exact,hold,target,freeHandle,readPtr,readS32,event});

 const {tick:buddyTick}=PGRazorFeatures.buddy({s,p,api,classes,BUDDY_TYPES,IBAG,ptr,invoke,itemArgs,itemNumber,itemInt,rocketBool,capturedKey,hold,target,freeHandle,alive,exact,readPtr,readS32,event,unity,Interceptor,getItemState:()=>itemState});

 const {tick:giftTick}=PGRazorFeatures.gifts({s,p,api,classes,fields,GIFT_TYPES,GIFT_OPEN_SEQUENCE,STATE_OPEN,ptr,Process,Memory,NativeFunction,NativeCallback,Interceptor,hold,target,freeHandle,alive,exact,readPtr,readS32,present,rocketBool,itemInt,itemArgs,itemNumber,invoke,event,unity});

 // Non-Rocket battle automation: separate scope, settings and roots.

 PGRazorFeatures.spawn({s,p,event,NativeFunction,NativeCallback,Interceptor});

 const {tick:berryTick}=PGRazorFeatures.berries({s,p,api,classes,fields,BERRY,IBAG,STATE_OPEN,hold,target,freeHandle,alive,exact,readPtr,readS32,rocketBool,itemInt,itemArgs,itemNumber,invoke,event,unity,ptr,Memory,Process,NativeFunction,NativeCallback,Interceptor,getItemState:()=>itemState});

 const {tick:battleTick}=PGRazorFeatures.battles({s,p,classes,rocketState,BATTLE_TYPES,RVCHARGE,unity,hold,freeHandle,target,alive,exact,readS32,readPtr,present,rocketBool,ptr,Memory,invoke,event,Interceptor});

 // VGP serializes ordinary map RPCs. Unknown outcomes never cause a repeated throw.
 const {mapPoiTick,vgpTick}=PGRazorFeatures.vgp({p,s,Interceptor,unity,exact,classes,VGP_NAMEPLATE,freeHandle,VGP,hold,event,target,invoke,api,Memory,SPINRESULT,itemArgs,alive,ptr,itemInt,present,fields,capturedKey,releaseRecord,finishTransfer,PK,readPtr,transferCatch,readS32,vgpPromise,getItemState:()=>itemState,itemNumber,RESP,BAG,IBAG,vgpField});

 const {itemState,itemTick}=PGRazorFeatures.items({s,p,freeHandle,api,invoke,ptr,itemArgs,hold,exact,classes,ISERVICE,Memory,event,target,readPtr,IBAG,itemNumber,itemInt,readS32,Interceptor,unity,text,typeName,IRESPONSE});

 function clearSpin(){const r=s.spinRecord;if(!r)return;s.spinRecord=null;freeHandle(r.state);if(r.gui)freeHandle(r.gui);}

 function spinPermitted(){return !s.stopping&&s.spinEnabled&&s.now()<s.spinAllowedUntil;}

 function spinBool(m,o){const h=hold(invoke(m.method,o));try{const b=target(h);if(!exact(b,classes[BOOL]))throw Error('spin-bool-type');return api.object_unbox(b).readU8()===1;}finally{freeHandle(h);}}

 function spinTick(now,tid){const r=s.spinRecord,t=p.spin;if(!r||!t)return;

  if(!spinPermitted()||r.epoch!==s.spinEpoch||now>=r.deadline){clearSpin();return;}

  if(s.openerDepth||s.matches<=r.tick)return;

  try{const state=target(r.state),gui=readPtr(state,t.fields.gui);if(gui.isNull())return;

   if(!exact(gui,classes[SPINGUI])||!alive(gui)){clearSpin();return;}

   if(r.gui&&!target(r.gui).equals(gui)){clearSpin();return;}

   const guiState=readS32(gui,fields.currentState);

   if(guiState!==1&&guiState!==STATE_OPEN)return;

   if(r.result!==undefined){if(guiState!==STATE_OPEN||s.matches<=r.resultTick)return;

    if(r.result===t.success){r.closed=true;invoke(t.methods.close.method,gui);event(s,'spin-dismissed',{tid,openedMs:now-r.openedAt});}

    else event(s,'spin-error',{result:r.result,tid});clearSpin();return;

   }

   if(r.sent)return;

   const gesture=readPtr(state,t.fields.gesture);if(!exact(gesture,classes[GESTURE])||!spinBool(t.methods.active,gesture))return;

   const spinner=readPtr(gesture,t.fields.spinner);if(!exact(spinner,classes[SPINNER])||!spinBool(t.methods.can,spinner))return;

   r.sent=true;r.gui=hold(gui);r.deadline=now+12000;

   const speed=Memory.alloc(4);speed.writeFloat(360);const args=Memory.alloc(8);args.writePointer(speed);

   invoke(t.methods.spin.method,spinner,args);

   // Normal threshold callback preserves native one-shot/range gates and result handling.

   invoke(t.methods.request.method,spinner);event(s,'spin-requested',{tid,immediate:true,guiState,openedMs:now-r.openedAt});

  }catch(e){event(s,'spin-error',{reason:String(e),tid});clearSpin();}

 }

 if(p.spin){const t=p.spin;

  s.listeners.push(Interceptor.attach(t.methods.spin.address,{onEnter(args){try{const r=s.spinRecord;if(!unity(this.threadId)||!r||r.sent||!spinPermitted())return;

   const gesture=readPtr(target(r.state),t.fields.gesture);if(exact(gesture,classes[GESTURE])&&readPtr(gesture,t.fields.spinner).equals(args[0])){r.sent=true;r.deadline=s.now()+12000;}

  }catch(_){clearSpin();}}}));

  s.listeners.push(Interceptor.attach(t.methods.enter.address,{onEnter(args){try{if(unity(this.threadId)&&spinPermitted()&&exact(args[0],classes[SPINSTATE])){clearSpin();s.spinRecord={state:hold(args[0]),epoch:s.spinEpoch,deadline:s.now()+15000,openedAt:s.now(),tick:s.matches};}}catch(e){clearSpin();}},onLeave(){if(s.spinRecord)s.spinRecord.tick=s.matches;}}));

  s.listeners.push(Interceptor.attach(t.methods.exit.address,{onEnter(args){if(unity(this.threadId)&&s.spinRecord&&target(s.spinRecord.state).equals(args[0]))clearSpin();}}));

  s.listeners.push(Interceptor.attach(t.methods.result.address,{onEnter(args){try{if(unity(this.threadId)&&exact(args[1],classes[SPINRESULT]))event(s,'cooldown-action',{action:'Pokestop spin'});const r=s.spinRecord;if(unity(this.threadId)&&spinPermitted()&&r&&r.sent&&target(r.state).equals(args[0])&&exact(args[1],classes[SPINRESULT])){this.record=r;this.result=readS32(args[1],t.fields.result);}}catch(_){}},onLeave(){if(this.record&&this.record===s.spinRecord){this.record.result=this.result;this.record.resultTick=s.matches;}}}));

 }



 function transferCatch(r,tid){

  const t=p.transfer;if(!s.transferEnabled||!t)return false;

  const f=t.fields,pk=target(r.pokemon),st=r.vgp?ptr(0):target(r.state),owned=[];

  function root(o){if(o.isNull())throw Error('transfer-missing-record');const h=hold(o);owned.push(h);return target(h);}

  function boolField(o,f){const b=Memory.alloc(1);api.field_get_value(o,f,b);const n=b.readU8();if(n>1)throw Error('transfer-invalid-bool');return n===1;}

  function boxed(m,o,args,bool){const b=root(invoke(m.method,o,args));if(!exact(b,classes[bool?BOOL:INT]))throw Error('transfer-boxed-type');const n=bool?api.object_unbox(b).readU8():api.object_unbox(b).readS32();if(bool&&n>1)throw Error('transfer-boxed-bool');return bool?n===1:n;}

  try{

   const bag=root(r.vgp?target(r.vgpBag):readPtr(st,f.bag));if(!exact(bag,classes[BAG]))throw Error('transfer-bag-type');

   const id=Memory.alloc(8);api.field_get_value(pk,p.details.fields.id,id);const args=Memory.alloc(8);args.writePointer(id);

   const current=invoke(t.methods.get.method,bag,args);

   if(r.transferRequested){

    if(r.transferComplete||r.transferFailed)return false;

    if(!s.transferPending.has(r.capturedKey)){r.transferFailed=true;return false;}

    return !s.dismissEnabled;

   }

   if(r.transferChecked)return false;r.transferChecked=true;

   if(current.isNull()||!exact(current,classes[PK])||capturedKey(current,p.details.fields.id)!==r.capturedKey)throw Error('transfer-bag-identity');

   root(current);
   const species=readS32(current,f.species),keep=transferKeepReason(species,s.keepSpecies,s.keepAll);
   if(keep){r.transferReason=keep;event(s,'transfer-kept',{reason:keep,capturedKey:r.capturedKey,tid});return false;}

   const display=root(readPtr(current,f.display));if(!exact(display,classes[DISPLAY]))throw Error('transfer-display-type');

   const gm=root(r.vgp?target(r.vgpGm):readPtr(st,f.gm));args.writePointer(gm);

   let size=null;if(s.protect&48){const value=root(invoke(t.methods.size.method,current,args));if(typeName(api,api.class_get_type(api.object_get_class(value)))!=='Holoholo.Rpc.CharacterSize')throw Error('transfer-size-type');size=api.object_unbox(value).readS32();if(!t.sizes.includes(size))throw Error('transfer-unknown-size');}
   const rare=boxed(t.methods.rare,current,args,true),shiny=boxed(t.methods.shiny,current,null,true);

   const origins=root(readPtr(current,f.events));if(!exact(origins,t.eventClass))throw Error('transfer-events-type');const count=boxed(t.methods.eventCount,origins,null,false);if(count<0)throw Error('transfer-event-count');

   const limited=readPtr(current,f.limited); // null or empty string is normal; any nonempty value is protected.

   let limitedEvent=false;if(!limited.isNull()){const len=api.class_get_method_from_name(api.object_get_class(limited),Memory.allocUtf8String('get_Length'),0);if(len.isNull())throw Error('transfer-string-length');limitedEvent=boxed({method:len},limited,null,false)!==0;}

   const v={species,xxs:size===t.xxs,xxl:size===t.xxl,attack:readS32(current,f.attack),defense:readS32(current,f.defense),stamina:readS32(current,f.stamina),rare,shiny,

    event:count>0||limitedEvent||readS32(display,f.costume)!==t.costumeNone||readS32(display,f.originalCostume)!==t.costumeNone,

    background:!readPtr(display,f.background).isNull()||readS32(display,f.art)!==t.artNone||readS32(display,f.artAsset)!==t.assetNone,

    favorite:boolField(current,f.favorite),egg:boolField(current,f.egg)};

   const reason=transferDecision(v,s.protect,s.keepSpecies,s.keepAll);if(reason){r.transferReason=reason;event(s,'transfer-kept',{reason,capturedKey:r.capturedKey,tid});return false;}

   if(s.transferSeen.has(r.capturedKey)||s.transferSeen.size>=4096){event(s,'transfer-kept',{reason:'duplicate-or-session-limit',tid});return false;}

   if(!s.transferEnabled||s.stopping||s.now()>=s.allowedUntil||r.epoch!==s.epoch||(r.vgp?!(s.now()<s.vgpLease&&exact(target(r.response),classes[RESP])&&readS32(target(r.response),fields.status)===p.success&&capturedKey(target(r.response))===r.capturedKey):!(r.direct?directCatchValid(r):detailsValid(r))))return false;

   s.transferSeen.add(r.capturedKey);r.transferRequested=true;r.transferDeadline=s.now()+10000;r.deadline=r.transferDeadline+1000;

   r.transferBag=hold(bag);s.transferPending.set(r.capturedKey,{record:r,epoch:s.epoch,deadline:r.transferDeadline,bag:hold(bag),pokemon:hold(current)});args.writePointer(current);

   const promise=invoke(t.methods.release.method,bag,args);if(promise.isNull())throw Error('transfer-no-promise');r.transferPromise=hold(promise);

   event(s,'transfer-requested',{capturedKey:r.capturedKey,iv:(v.attack+v.defense+v.stamina)/45*100,protect:s.protect,tid});return !s.dismissEnabled;

  }catch(e){if(r.transferRequested)finishTransfer(r.capturedKey,false,String(e));r.transferChecked=true;r.transferFailed=true;event(s,r.transferRequested?'transfer-unconfirmed':'transfer-kept',{reason:String(e),capturedKey:r.capturedKey,tid});return false;}

  finally{for(const h of owned)freeHandle(h);}

 }

 function dismissDetails(r,tid){const gui=target(r.gui);

  if(!alive(gui)||!detailsValid(r)){cancel(r,'details-identity-mismatch');return;}

  const before=readS32(gui,fields.currentState);if(before!==STATE_OPEN){cancel(r,'details-state-not-open:'+before);return;}

  if(s.stopping||r.cancelled||r.epoch!==s.epoch||s.allowedUntil===0||s.now()>=s.allowedUntil||s.openerDepth!==0){cancel(r,'permission-revoked');return;}

  if(transferCatch(r,tid))return;

  // Transfer verification must not veto the user's independent auto-dismiss setting.

  if(!s.dismissEnabled&&!r.transferComplete){cancel(r,'kept-details-open');return;}

  r.invoked=true;s.invoking=true;s.invokingGui=gui;let error=null;

  try{invoke(p.details.methods.click.method,gui);}catch(e){error=String(e);}finally{s.invoking=false;s.invokingGui=null;}

  let after=null,gone=false;try{if(alive(gui))after=readS32(gui,fields.currentState);else gone=true;}catch(_){}

  if(gone||(after!==null&&after!==STATE_OPEN))r.canvasHidden=false;
  hideDismissedCatch(gui,r,after,gone,error);

  event(s,'details-dismiss-invoked',{tid,stateBefore:before,stateAfter:after,guiGone:gone,error,advanced:gone||(after!==null&&after!==STATE_OPEN)});

  releaseRecord(r);const i=s.records.indexOf(r);if(i>=0)s.records.splice(i,1);

 }

 if(p.details){const d=p.details,f=d.fields;

  openHook(d.methods.present.address,{

   onEnter(args){for(const r of s.records)if(r.kind==='details')cancel(r,'new-details-presentation');

    if(!exact(args[0],classes[VIEW])||!exact(args[1],classes[PK]))return null;

    const response=readPtr(args[0],f.viewResponse);

    if(!exact(response,classes[RESP])||readS32(response,fields.status)!==p.success||!present(response,fields.caughtId,8)||capturedKey(args[1],f.id)!==capturedKey(response))return null;

    const r={kind:'details',epoch:s.epoch,deadline:s.now()+LIMITS.timeoutMs,readyMatch:null,initDone:false,presentDone:false,openCompleteDone:false,invoked:false,cancelled:null,capturedKey:capturedKey(response)};

    s.records.push(r);r.state=hold(args[0]);r.pokemon=hold(args[1]);r.response=hold(response);if(s.pendingDetails&&target(s.pendingDetails.response).equals(response))releasePendingDetails();detailFrames.push(r);event(s,'details-presentation-observed',{tid:s.thread});return{r};},

   onLeave(payload){payload.r.presentDone=true;},release(payload){const i=detailFrames.lastIndexOf(payload.r);if(i>=0)detailFrames.splice(i,1);}});

  openHook(d.methods.initialize.address,{

   onEnter(args){const old=findByGui(args[0]);if(old)cancel(old,'details-reinitialized');

    if(!exact(args[0],classes[DGUI])||!exact(args[1],classes[DATA]))return null;

    const callback=readPtr(args[1],f.onDismissed);if(!exact(callback,classes[ACTION]))return null;

    const owner=readPtr(callback,f.delegateTarget);

    const r=s.records.find(x=>x.kind==='details'&&!x.cancelled&&!x.gui&&x.state&&target(x.state).equals(owner));if(!r)return null;

    r.gui=hold(args[0]);r.data=hold(args[1]);return{r};},

   onLeave(payload){const r=payload.r,callback=readPtr(target(r.data),f.onDismissed);

    if(callback.isNull()||!readPtr(target(r.gui),f.callback).equals(callback)||!readPtr(target(r.gui),f.data).equals(target(r.data))){cancel(r,'details-not-initialized');return;}

    r.dismissed=hold(callback);r.initDone=true;hideOpeningDetails(r);event(s,'details-initialized',{tid:s.thread});}});

  openHook(d.methods.open.address,{onEnter(args){const r=findByGui(args[0])||recoverDetails(args[0]);if(r&&r.kind==='details')hideOpeningDetails(r);return r&&r.kind==='details'?{r}:null;},onLeave(payload){hideOpeningDetails(payload.r);payload.r.openCompleteDone=true;payload.r.readyMatch=null;event(s,'details-open-complete',{tid:s.thread});}});

  s.listeners.push(Interceptor.attach(d.methods.exit.address,{onEnter(args){try{if(!unity(this.threadId))return;for(const r of s.records)if(r.kind==='details'&&r.state&&target(r.state).equals(args[0]))cancel(r,'details-state-exit');}catch(e){fault(s,e);}}}));

  s.listeners.push(Interceptor.attach(d.methods.click.address,{onEnter(args){try{if(!unity(this.threadId)||s.invoking)return;const r=findByGui(args[0]);if(r&&r.kind==='details')cancel(r,'details-user-dismiss');}catch(e){fault(s,e);}}}));

 }

 // ---- Unity-thread filter (tick + thread identity) ----

 const depths=new Map();

 const enter=new NativeCallback(tid=>{if(!s.active)return 0;const depth=depths.get(tid)||0;depths.set(tid,depth+1);return 1;},'int',['uint32']);

 const leave=new NativeCallback(tid=>{if(!s.active)return;const depth=(depths.get(tid)||1)-1;if(depth){depths.set(tid,depth);return;}depths.delete(tid);

  if(s.thread===null)s.thread=tid;else if(s.thread!==tid){fault(s,Error('unity-thread-changed'));return;}

  s.matches++;cleanupTick(tid);},'void',['uint32']);

 if(retainedFilters.length>=16)throw Error('native-filter-session-limit');

 const slot=Memory.alloc(8);slot.writePointer(methods.execute.method);const filter=new CModule(FILTER,{execute_method:slot,enter_match:enter,leave_match:leave});

 retainedFilters.push({filter,slot,enter,leave});const exports=new Set();

 for(const name of['il2cpp_runtime_invoke','il2cpp_runtime_invoke_convert_args']){const address=p.module.findExportByName(name);if(!address||address.isNull()||exports.has(address.toString()))continue;exports.add(address.toString());s.listeners.push(Interceptor.attach(address,{onEnter:filter.on_enter,onLeave:filter.on_leave}));}

 if(!exports.size)throw Error('invocation-filter-unavailable');

 s.ready=true;event(s,'metadata-ready',{fields:p.fieldMeta,successValue:p.success,caughtIdSize:p.caughtIdSize,stateOpen:STATE_OPEN,leaseMs:LIMITS.leaseMs,timeoutMs:LIMITS.timeoutMs,

  directPresentationAvailable:!!p.directPresentation,directPresentationError:p.directPresentationError,catchSceneAvailable:!!p.catchScene,catchSceneError:p.catchSceneError,catchDiscoveryAvailable:!!p.catchDiscovery,catchDiscoveryError:p.catchDiscoveryError,catchCanvasAvailable:!!p.catchCanvas,catchCanvasError:p.catchCanvasError,covers:p.details?['summary-auto-dismiss','post-catch-stats-details']:['summary-auto-dismiss'],detailsAvailable:!!p.details,detailsError:p.detailsError,transferAvailable:!!p.transfer,transferError:p.transferError,spinAvailable:!!p.spin,spinError:p.spinError,spinCameraAvailable:!!p.spinCamera,spinCameraError:p.spinCameraError,itemLookupAvailable:!!(p.items&&p.items.lookup),itemsAvailable:!!p.items,itemsError:p.itemsError,rocketAvailable:!!p.rocket,rocketError:p.rocketError,berriesAvailable:!!p.berries,berriesError:p.berriesError,battlesAvailable:!!p.battles,battlesError:p.battlesError,notCovered:['new-species-cutscene','new-form-cutscene','xp-toast-presentation']});

}

function start(options){

 if(!options||options.enabled!==true)return Promise.resolve({status:'disabled'});if(running)return Promise.resolve({status:'already-running'});

 let resolve;const promise=new Promise(r=>resolve=r);const s={promise,resolve,onEvent:options.onEvent,active:true,ready:false,stopping:false,reason:null,listeners:[],queue:[],records:[],pendingDetails:null,transferEnabled:false,protect:63,dismissEnabled:true,transferSeen:new Set(),transferPending:new Map(),itemRules:{},itemConfig:'',itemEnabled:false,itemLease:0,itemEpoch:0,spinRecord:null,spinEnabled:false,spinAllowedUntil:0,spinEpoch:0,ownedHandles:new Set(),openerDepth:0,invoking:false,invokingGui:null,allowedUntil:0,epoch:0,thread:null,matches:0,busy:false,retries:0,timer:null,clockReady:false,cleanupReported:false,routes:null,now:()=>0};running=s;

 function finish(){for(const h of s.listeners)try{h.detach();}catch(_){}s.listeners=[];s.active=false;const result={status:s.reason?'unavailable':'cancelled'};if(s.reason)result.reason=s.reason;event(s,'finished',result);flush(s);if(running===s)running=null;s.resolve(result);}

 function poll(){s.timer=null;if(!s.active)return;

  try{

   if(!s.ready&&!s.stopping){if(Process.arch!=='arm64'||Process.pointerSize!==8)throw Error('unsupported-architecture');

    if(!s.clockReady){s.now=clock();s.clockReady=true;}

    const module=Process.findModuleByName('libil2cpp.so');if(module){const api=bind(module),domain=api.domain_get();if(!domain.isNull()){const prep=prepare(module,api,domain);if(prep)install(s,prep);}}

    if(!s.ready)s.retries++; /* Wait for game metadata during slow cold starts. */}

   if(s.stopping&&s.ownedHandles.size&&!s.cleanupReported){s.cleanupReported=true;event(s,'cleanup-pending',{reason:s.reason||'stop',pending:true});}

   flush(s);

   // Owned records, like quick-ball attempts, wait for a Unity-thread release.

   if(s.stopping&&s.records.length===0&&s.ownedHandles.size===0&&s.openerDepth===0&&!s.busy){finish();return;}

  }catch(e){fault(s,e);}

  s.timer=setTimeout(poll,s.ready?LIMITS.pollMs:1000);}

 s.timer=setTimeout(poll,0);return promise;}

function setAllowed(value){const s=running;if(!s||!s.active||!s.ready||s.stopping)return false;try{const now=s.now();if(value!==true||now>=s.allowedUntil)s.epoch++;s.allowedUntil=value===true?now+LIMITS.leaseMs:0;return value===true;}catch(e){fault(s,e);return false;}}

function setSpinAllowed(value){const s=running;if(!s||!s.active||!s.ready||s.stopping)return false;const now=s.now(),enabled=value===true;if(s.spinEnabled!==enabled||now>=s.spinAllowedUntil)s.spinEpoch++;s.spinEnabled=enabled;s.spinAllowedUntil=enabled?now+LIMITS.leaseMs:0;return enabled;}

function setSpawnOptions(enabled,allowed){const s=running;if(!s||!s.ready||s.stopping)return false;s.spawnEnabled=enabled===true;s.spawnLease=allowed===true?s.now()+LIMITS.leaseMs:0;return s.spawnEnabled;}

function setMapPoiAllowed(allowed){const s=running;if(!s||!s.active||s.stopping)return false;s.mapPoiLease=allowed===true?s.now()+2500:0;return true;}
function setVgpManualReady(){const s=running;if(s&&!s.stopping)s.vgpManualReady=true;}
function setVgpOptions(mask,allowed,lat,lon,mapVisible){const s=running;if(!s||!s.active||s.stopping)return false;s.vgpMask=(mask|0)&3;s.vgpLat=lat;s.vgpLon=lon;s.vgpMapVisible=mapVisible===true;s.vgpLease=allowed===true&&Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180?s.now()+2500:0;return true;}

function setIncubatorOptions(enabled,longest,allowed){const s=running;if(!s||!s.active||s.stopping)return false;s.incubatorEnabled=enabled===true;s.incubatorLongest=longest===true;s.incubatorLease=allowed===true?s.now()+2500:0;return !!s.incubatorEnabled;}

function setBuddyOptions(berry,allowed){const s=running;if(!s||!s.active||s.stopping)return false;const next=[701,703,705,706,707].includes(berry)?berry:0;s.buddyBerry=next;s.buddyLease=allowed===true?s.now()+2500:0;return true;}

function setGiftOptions(mask,allowed){const s=running;if(!s||!s.ready||s.stopping)return false;s.giftMask=Number.isInteger(mask)&&mask>=0&&mask<=7?mask:0;s.giftLease=allowed===true?s.now()+LIMITS.leaseMs:0;const key=s.giftMask+':'+(allowed===true);if(s.giftPermission!==key){s.giftPermission=key;event(s,'gift-permission',{mask:s.giftMask,allowed:allowed===true});}return !!(s.giftMask&3);}

function setBerryImpactReady(){const s=running;if(s&&!s.stopping)s.berryImpactReady=true;}

function setBerryOptions(value,allowed){return PGRazorBerryPolicy.set(running,value,allowed,LIMITS.leaseMs);}

function setBattleOptions(mask,allowed){const s=running;if(!s||!s.ready||s.stopping)return false;s.battleMask=Number.isInteger(mask)&&mask>=0&&mask<=1023?mask:0;s.battleLease=allowed===true?s.now()+LIMITS.leaseMs:0;return s.battleMask>0;}

function setRocketOptions(mask,allowed){const s=running;if(!s||!s.ready||s.stopping)return false;s.rocketMask=Number.isInteger(mask)&&mask>=0&&mask<=7?mask:0;s.rocketLease=allowed===true?s.now()+LIMITS.leaseMs:0;return s.rocketMask>0;}

function setItemOptions(enabled,rules,allowed){const s=running;if(!s||!s.ready||s.stopping)return false;const parsed={};let valid=true;

 for(const part of String(rules||'').split(';')){if(!part)continue;const match=/^(\d{1,7}):(\d{1,6})$/.exec(part);if(!match||+match[1]<=0||+match[2]>100000||Object.prototype.hasOwnProperty.call(parsed,match[1])){valid=false;break;}parsed[match[1]]=+match[2];}

 const config=valid?JSON.stringify(parsed):'{}',on=enabled===true&&valid;if(s.itemConfig!==config||s.itemEnabled!==on||allowed!==true||s.now()>=s.itemLease)s.itemEpoch++;s.itemRules=valid?parsed:{};s.itemConfig=config;s.itemEnabled=on;s.itemLease=allowed===true?s.now()+LIMITS.leaseMs:0;return on;

}

// Bridge entry for the native Routes module. allowed is a fresh foreground lease
// for an open Routes modal or active walking; commandJson is the JSON command.
// setRoutesOptions(false,...) cannot execute new actions; roots clean up on tick.
function setAdventureSyncAllowed(allowed){const s=running;if(s&&s.active&&!s.stopping&&s.adventureSync)s.adventureSync.setAllowed(allowed===true);}
function setRoutesOptions(allowed,commandJson){const s=running;if(!s||!s.ready||s.stopping||!s.routes)return false;
 try{return s.routes.setOptions(allowed===true,commandJson);}catch(e){event(s,'routes-options-error',{reason:String(e)});return false;}}

function stop(){const s=running;if(!s)return Promise.resolve({status:'idle'});s.allowedUntil=0;s.stopping=true;return s.promise;}

function setTransferOptions(enabled,protect,dismiss,keepSpecies='',keepAll=false){const s=running;if(!s||!s.active||s.stopping)return false;
 const ids=transferKeepSet(keepSpecies),config=ids?[...ids].sort((a,b)=>a-b).join(','):null;
 const keep=keepAll===true,next=enabled===true&&ids!==null&&!keep,mask=Number.isInteger(protect)&&protect>=0&&protect<=63?protect:63;
 if(s.transferEnabled!==next||s.protect!==mask||s.keepConfig!==config||s.keepAll!==keep)s.epoch++;
 s.transferEnabled=next;s.protect=mask;s.keepSpecies=ids;s.keepConfig=config;s.keepAll=keep;s.dismissEnabled=dismiss===true;return ids!==null;}

const api=Object.freeze({start,setIncubatorOptions,setMapPoiAllowed,setVgpOptions,setVgpManualReady,setAllowed,setSpinAllowed,setTransferOptions,setItemOptions,setRocketOptions,setBattleOptions,setBerryOptions,setBerryImpactReady,setSpawnOptions,setGiftOptions,setBuddyOptions,setRoutesOptions,setAdventureSyncAllowed,transferDecision,transferKeepSet,transferKeepReason,stop});root.PGRazorQuickClose=api;return api;

})(globalThis);
