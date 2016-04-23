'use strict'; // use of the arguments.callee property is forbidden in strict mode

/* Services */

angular.module('radioServices', []).
    constant('API_KEY', '031d7fac215b370e7179b8354a2f7f77').
    factory('Radio', ['$rootScope', '$http', '$q', function ($rootScope, $http, $q) {

        var service = {};
        var asService = new AudioscrobblerService($http);
        var ytService = new YouTubeService($http);
        var player;
        var station;            // { artists:[ { name:, match:, songCount, songs:[ { name:, playcount: } ] ] };
        var playContext = {};   // { trackPlay:, trackCue:, isPlaying: }
        var stationList;        // { {key:{name:}} }

        var settings = {};      // { stationId: }
        var history = [];       // [ { artist: title: } ]
        var favorites = [];     // [ { artist: title: tags:[] ];
        var donots = [];        // [ { artist: title: } ]
        var idmap = {};         // { key:{id:, stSec: }

        var forbiddens = [];    // YouTubeで見つからない/再生できない曲（いらなくなる可能性あり）
        var playlist;

        var DEFAULT_SONG_COUNT = 50;
        var HISTORY_SIZE = 100;
        var FORBIDDENS_SIZE = HISTORY_SIZE + 20;    // サイズはhistoryより大きくすること

        var CUEMODE = { cue: 0, play: 1, playCue: 2 };  // cueVideo()で使用


        // forbiddens に曲を追加する
        function addForbiddens(track) {
            if (searchTrack(forbiddens, track) == -1) {
                forbiddens.push(track);
                if (forbiddens.length > FORBIDDENS_SIZE)
                    forbiddens.shift();
            }
            // station の曲にそのタイトルがあるならforbiddenフラグを立てておく
            station.artists.forEach(function (artist) {
                if (artist.name == track.artist) {
                    var index = searchTitle(artist.songs, track.title);
                    if (index > -1) {
                        artist.songs[index].forbidden = true;
                    }
                }
            });
        }

        // アーティストリストから指定したアーティスト名と同じ要素を検索する
        function searchArtist(artistArray, artist) {
            Debug.assert(typeof artist == "string", "searchArtist: artist must be string");
            for (var i = 0; i < artistArray.length; i++) {
                var element = artistArray[i];
                if (element.name == artist) {
                    return i;
                }
            }
            return -1;
        }
        // 曲タイトルリストから指定した曲名と同じ要素を検索する
        function searchTitle(titleArray, title) {
            Debug.assert(typeof title == "string", "searchTitle: title must be string");
            for (var i = 0; i < titleArray.length; i++) {
                var element = titleArray[i];
                if (element.name == title) {
                    return i;
                }
            }
            return -1;
        }
        // 曲リストから指定した曲（注：オブジェクト）と同名の要素を検索する
        function searchTrack(trackArray, track) {
            Debug.assert(typeof track == "object", "searchTrack: track must be object");
            for (var i = 0; i < trackArray.length; i++) {
                var element = trackArray[i];
                if (element.artist == track.artist && element.title == track.title) {
                    return i;
                }
                if (element.hasOwnProperty("videoId") && track.hasOwnProperty("videoId")) {
                    if (element.videoId == track.videoId)
                        return i;
                }
            }
            return -1;
        }


        // 曲タイトルからYouTube動画IDを得る
        service.getVideoId = function (track) {
            if (track == null)
                track = history[0];
            var key = track.artist + "-" + track.title;
            return idmap[key];
        }

        // 曲タイトルとYouTube動画IDを対応させる（タイトルが空だと現在再生中の動画）
        service.setVideoId = function (track, videoId, stSec) {
            if (track == null)
                track = history[0];
            var key = track.artist + "-" + track.title;
            if (videoId == null || videoId.length == 0) {
                // 動画IDが空なら対応付けを削除する
                delete idmap[key];
            } else {
                var oldKey = getKeyFromValue(videoId);
                if (oldKey != null)
                    delete idmap[oldKey];
                idmap[key] = { id: videoId };
                if (stSec)
                    idmap[key].stSec = stSec;
            }
            cueVideo(track, CUEMODE.play); // 試し再生
            saveIdmap();

            // 動画ID(value)から曲タイトル(key)を得る（逆引き）
            function getKeyFromValue(value) {
                for (var key in idmap) {
                    if (value == idmap[key].id)
                        return key;
                }
                return null;
            }
        }


        service.station = function () {
            return station;
        }

        service.stationList = function () {
            return stationList;
        }

        // ステーションが一つもない状態かどうか
        service.isEmpty = function () {
            return Object.keys(stationList).length == 0;
        }

        // ステーション名の変更
        // ステーション名は、localStorageのkeyでもあるので（xxxxxxx.ステーション名)
        // 前keyのvalueを退避して新keyにそのvalueを書き込み。最後に前のkeyを削除する
        service.renameStation = function (key, name) {
            var oldId = key + "." + stationList[key].name;
            var newId = key + "." + name;
            if (newId != oldId) {
                stationList[key].name = name;
                var value = localStorage.getItem(oldId);
                localStorage.setItem(newId, value);
                localStorage.removeItem(oldId);
                if (settings.stationId == oldId) {
                    settings.stationId = newId;
                    saveSettings();
                    station.name = getStationName();
                }
            }
        }

        // ステーションの変更
        service.changeStation = function (key) {
            var stationId = key + "." + stationList[key].name;
            if (playlist != null || stationId != settings.stationId) {
                settings.stationId = stationId;
                saveSettings();
                //window.location.reload();   // リロード（これが一番簡単）

                // delete playlist
                if (playlist)
                    playlist = null;

                // Load Station
                var jsonString = localStorage.getItem(settings.stationId);
                station = JSON.parse(jsonString);
                if (station == null) {  // key = settings.stationId の value がない（まずあり得ない）
                    delete settings.stationId;
                    saveSettings();
                } else {
                    station.name = getStationName();
                }

                playContext.trackCue = null;
                loadTopTracks();    // get artist songs

                $rootScope.$broadcast("StationChanged");
            }
        }

        // ステーションの削除
        service.removeStation = function (key) {
            // favoritesのtagからステーションIDを削除する
            favorites.forEach(function (entry) {
                var index = entry.tags.indexOf(key);
                if (index != -1) {
                    entry.tags.splice(index, 1);
                }
            });
            var stationId = key + "." + stationList[key].name;
            localStorage.removeItem(stationId);
            delete stationList[key];
            if (stationId == settings.stationId) {
                delete settings.stationId;
                saveSettings();
                station = null; // ステーションを閉じる（これでいいのか？）
                player.stop();
                playContext.trackCue = null;
                //window.location.reload();   // リロード（これが一番簡単）
                $rootScope.$broadcast("StationListChanged");
            } else {
                $rootScope.$broadcast("StationListChanged");
            }
        }

        service.getStationId = function () {
            return getStationId();
        }

        // ステーションIDの取得
        function getStationId() {
            if (settings.stationId == null)
                return null;
            var index = settings.stationId.indexOf(".");
            return {
                id: settings.stationId.substr(0, index),
                name: settings.stationId.substr(index + 1)
            };
        }

        // !!! legacy !!!
        function getStationName() {
            if (settings.stationId == null)
                return null;
            var index = settings.stationId.indexOf(".");
            return settings.stationId.substr(index + 1);
        }

        // ステーション名リストの作成
        function updateStationList() {
            stationList = {};
            for (var i = 0; i < localStorage.length; i++) {
                Debug.log("localStorage key[" + i + "] = " + localStorage.key(i));
                var key = localStorage.key(i);
                if (key.charAt(0) != "$") {
                    var index = key.indexOf(".");
                    stationList[key.substr(0, index)] = { name: key.substr(index + 1) };
                }
            }
        }

        // 初期処理（ストレ－ジからの読み込み）
        function loadStation() {

            // station list
            updateStationList();

            // settings
            var jsonString = localStorage.getItem("$settings");
            settings = JSON.parse(jsonString);
            if (settings == null)
                settings = {};

            // history
            var jsonString = localStorage.getItem("$history");
            history = JSON.parse(jsonString);
            if (history == null)
                history = [];

            // favorites
            var jsonString = localStorage.getItem("$favorites");
            favorites = JSON.parse(jsonString);
            if (favorites == null)
                favorites = [];

            // donots
            var jsonString = localStorage.getItem("$donots");
            donots = JSON.parse(jsonString);
            if (donots == null)
                donots = [];

            // idmap
            var jsonString = localStorage.getItem("$idmap");
            idmap = JSON.parse(jsonString);
            if (idmap == null)
                idmap = {};

            // ステーション情報を読み込む
            if (settings.stationId != null) {
                // Station
                jsonString = localStorage.getItem(settings.stationId);
                station = JSON.parse(jsonString);
                if (station == null) {  // key = settings.stationId の value がない（まずあり得ない）
                    delete settings.stationId;
                    saveSettings();
                } else {
                    station.name = getStationName();
                }
            }

            // YouTube playerを生成する
            player = new YouTubePlayer(function () {
                // ステーションに含まれるアーティストの曲を取得しにいく。
                if (station)
                    loadTopTracks();    // get artist songs
            }, onStateChange, onPlayerError);


            //var promise = loadPlayer();
            //promise.then(function (greeting) {

            //    playContext.playerReady = true;

            //    // ステーションが開かれていたなら曲を取りに行く
            //    if (settings.stationId != null) {
            //        loadTopTracks();    // get artist songs
            //    }

            //}, function (reason) {
            //});


            settings.crossFade = settings.crossFade || false;
            settings.repeat = settings.repeat || false;
            player.crossFade(settings.crossFade);

            Debug.dir(settings);
            Debug.dir(station);
            Debug.dir(favorites);
            Debug.dir(donots);
            Debug.dir(idmap);
        }

        //// YouTube playerを生成する
        //function loadPlayer() {
        //    var deferred = $q.defer();

        //    player = new YouTubePlayer(function () {
        //        deferred.resolve("hello");
        //    }, onStateChange);

        //    return deferred.promise;
        //}

        loadStation();

        // ステーションの保存
        function saveStation() {
            Debug.assert(settings.stationId, "unset settings.stationId");
            var temp = { artists: [] }
            station.artists.forEach(function (artist) {
                var entry = { name: artist.name, match: artist.match };
                if (artist.songCount && artist.songCount != DEFAULT_SONG_COUNT)
                    entry.songCount = artist.songCount;
                temp.artists.push(entry);
            });
            //var jsonString = JSON.stringify(temp);
            var jsonString = angular.toJson(temp);
            localStorage.setItem(settings.stationId, jsonString);
        }
        // 設定の保存
        function saveSettings() {
            var jsonString = angular.toJson(settings);
            localStorage.setItem("$settings", jsonString);
        }
        // 視聴履歴の保存
        function saveHistory() {
            var jsonString = angular.toJson(history);
            localStorage.setItem("$history", jsonString);
        }
        // お気に入りの保存
        function saveFavorites() {
            var jsonString = angular.toJson(favorites);
            localStorage.setItem("$favorites", jsonString);
        }
        // 再生しないでリストの保存
        function saveDonots() {
            var jsonString = angular.toJson(donots);
            localStorage.setItem("$donots", jsonString);
        }
        // VideoIDテーブルの保存
        function saveIdmap() {
            var jsonString = angular.toJson(idmap);
            localStorage.setItem("$idmap", jsonString);
        }

        // アーティスト・リストのクリア
        function clear() {
            station.artists.length = 0;
            //localStorage.removeItem(settings.stationId);
            localStorage.clear();
        }

        // 曲検索
        var searchResults = {};
        service.search = function (query, page, success, fail) {
            //if (searchResults.tracks != null)
            //    searchResults.tracks.length = 0;
            asService.searchTrack(query, page, 30, function (data) {
                Debug.dir(data);
                var matches = data.results.trackmatches.track;
                searchResults.query = query;
                searchResults.page = page;
                searchResults.tracks = [];
                searchResults.totalResults = parseInt(data.results['opensearch:totalResults']);
                if (matches != null) {
                    if (matches instanceof Array) {
                        matches.forEach(function (track) {
                            searchResults.tracks.push({ artist: track.artist, title: track.name });
                        });
                    } else {
                        searchResults.tracks.push({ artist: matches.artist, title: matches.name });
                    }
                }
                if (success)
                    success(searchResults);
            }, function () {    // サーバーエラー時の処理（レスポンスが何かないと困る時もあるので）
                if (fail)
                    fail();
            });
            //return searchResults;
        }

        // アーティスト詳細を返す（artistオブジェクトを返すだけ）
        service.getArtistDetail = function (index) {
            if (!station || isNaN(index) || index >= station.artists.length)
                return null;
            return station.artists[index];
        }

        // アーティスト情報取得（今のところartistオブジェクトを返すだけ）
        var artist = {};
        service.getArtistProfile = function (name, success, fail) {

            // アーティスト画像を取得
            //asService.getInfo(name, function (data) {
            //    Debug.dir(data);
            //    if (data.error != null) {   // api が返すエラー
            //        Debug.error("artist.search error:" + data.error + "[" + data.message + "]");
            //        return;
            //    }

            //    // アーティスト画像を取得
            //    artist.image = data.artist.image[2]['#text'];
            //    Debug.log("アーティスト画像 : ", artist.image);
            //});

            var index;
            if (station && (index = searchArtist(station.artists, name)) != -1) {
                //return station.artists[index];
                if (success)
                    success(station.artists[index]);
            } else {
                artist.name = name;
                artist.songs = [];
                getTopTracks(artist, DEFAULT_SONG_COUNT, function (artist) {
                    if (success)
                        success(artist);
                }, function () {
                    if (fail)
                        fail();
                });
                //return artist;
            }
        }


        // ステーションの新規作成
        service.create = function (artistName) {
            buildArtistList(artistName, 30, function (artists) {
                if (artists.length > 0) {

                    // delete playlist
                    if (playlist)
                        playlist = null;

                    // create station
                    artistName = artists[0].name;
                    //station = { artists: artists, name: artistName }; // これでもいいのか？
                    station = { artists: [], name: artistName };

                    artists.forEach(function (artist) {
                        station.artists.push(artist);
                    });

                    // build station-ID
                    var id = Math.round(new Date().getTime() / 1000).toString();
                    settings.stationId = id + "." + artistName;

                    saveSettings();
                    saveStation();
                    loadTopTracks(true);

                    // update station list
                    stationList[id] = { name: artistName };
                    $rootScope.$broadcast("StationListChanged", id);
                }
            });
        }

        // ステーションにアーティストを追加する
        service.addArtist = function (artistName, count) {
            var index = station.artists.length;
            buildArtistList(artistName, count, function (artists) {
                if (artists.length > 0) {

                    artists.forEach(function (artist) {
                        // ダブっていたらダブったアーティストのmatchを更新して次へ
                        var idx;
                        if ((idx = searchArtist(station.artists, artist.name)) >= 0) {
                            station.artists[idx].match = Math.max(artist.match, station.artists[idx].match);
                            return;
                        }
                        station.artists.push(artist);
                    });

                    loadTopTracks2(index);
                    saveStation();
                }
            });
        }

        // アーティストを削除する
        service.removeArtist = function (index, count) {
            station.artists.splice(index, count);
            saveStation();
        }

        // アーティスト・リストをクリアする
        service.clearArtists = function () {
            player.cancel();
            clear();
        }

        // アーティストの曲リストを作成・追加する
        service.getTracks = function (artist) {
            //$rootScope.$broadcast("serviceCallStart");    // とりあえず(呼ぶ方で処理すべきかも）
            getTopTracks(artist, DEFAULT_SONG_COUNT, function (artist) {
                //$rootScope.$broadcast("serviceCallEnd");    // とりあえず(呼ぶ方で処理すべきかも）
                $rootScope.$broadcast("artistSongsUpdate", artist); // これやらないとViewの一部が更新されない
            }, function () {
                //$rootScope.$broadcast("serviceCallEnd");    // とりあえず(呼ぶ方で処理すべきかも）
            });
        }

        // アーティストの曲数を設定する
        service.setSongCount = function (artist, count) {
            artist.songCount = count; //とりあえず
            saveStation();
        }
        service.getSongCount = function (artist) {
            var count = Math.min(artist.songs.length, artist.songCount ? artist.songCount : DEFAULT_SONG_COUNT);
            return count; //とりあえず
        }

        // ステーションを強制的に保存する
        service.doSaveStation = function () {
            saveStation();
            Debug.log("saved!");
        }

        // アーティスト・リストの作成
        // ※ サーバーエラーが起きたときは何も作成されない (station.artists.length = 0)
        //function buildArtistList(artistName, isNew, func) {
        function buildArtistList(artistName, count, successCb, errorCb) {

            getSimilar(artistName, count, successCb, onError);

            //var count = isNew ? 30 : 10;
            //getSimilar(artistName, count, onSuccess, onError);

            //function onSuccess(artists) {
            //    if (func)
            //        func(artists);
            //}

            function onError() {
                // 指定されたアーティスト名で検索（getSimilarでエラーが起きたときの救済処理）
                asService.getArtist(artistName, function (data) {
                    Debug.dir(data);
                    if (data.error != null) {   // api が返すエラー
                        Debug.error("artist.search error:" + data.error + "[" + data.message + "]");
                        if (errorCb)
                            errorCb();
                        return;
                    }

                    // アーティスト名の確定
                    var artist = data.results.artistmatches.artist;
                    if (artist == null) {
                        Debug.error("この名前のアーティストはいない [" + artistName + "]");
                        if (errorCb)
                            errorCb();
                        return;
                    } else if (artist[0] != null) {
                        artistName = artist[0].name;
                    } else {
                        artistName = artist.name;
                    }

                    // もう一度検索する
                    //getSimilar(artistName, count, onSuccess);
                    getSimilar(artistName, count, successCb, errorCb);
                });
            }

            // 似たアーティストを取得してリストに追加する
            //function getSimilar(artistName, isNew, onSuccess, onError) {
            function getSimilar(artistName, count, onSuccess, onError) {
                Debug.assert(onSuccess, "getSimilar: onSuccess is null!");

                asService.getSimilarArtists(artistName, count, function (data) {
                    if (data.error != null) {   // api が返すエラー
                        Debug.error("getSimilar error " + data.error + " (" + data.message + ") [" + artistName + "]");
                        if (onError != null)
                            onError();
                        return;
                    }
                    Debug.dir(data.similarartists);

                    //if (isNew) {
                    //    station.artists.length = 0; // clear artists
                    //    if (playlist)
                    //        playlist.length = 0;
                    //}

                    var artists = [];


                    var similars = data.similarartists.artist;

                    // data.similarartists.artistが文字列の場合もある
                    //if (typeof similars == "object") {
                    if (similars instanceof Array) {

                        // SimilarArtistsの先頭に指定されたアーティスト自身を入れておく
                        artistName = data.similarartists['@attr'].artist;   // 正しいアーティスト名が入る(autocorrect=1)
                        similars.unshift({
                            name: artistName,
                            match: 1,
                        });

                        // アーティストのリストを作成する
                        similars.forEach(function (similarArtist) {

                            var match = Math.ceil(parseFloat(similarArtist.match) * 10);
                            //if (!isNew) {
                            //    // ダブっていたらダブったアーティストのmatchを更新して次へ
                            //    var index;
                            //    if ((index = searchArtist(station.artists, similarArtist.name)) >= 0) {
                            //        station.artists[index].match = Math.max(match, station.artists[index].match);
                            //        return;
                            //    }
                            //}
                            var artist = {
                                name: similarArtist.name,
                                match: match,
                                //image: entry.image[2]['#text'],
                                songs: new Array()
                            }
                            //station.artists.push(artist);
                            artists.push(artist);
                        });

                    } else if (typeof similars == "string") {
                        // similarartistsが取れない場合（しかしエラーも起きない）

                        //if (!isNew) {
                        //    // ダブっていたらダブったアーティストのmatchを更新して次へ
                        //    var index;
                        //    if ((index = searchArtist(station.artists, artistName)) >= 0) {
                        //        station.artists[index].match = 10;
                        //        return;
                        //    }
                        //}
                        var artist = {
                            name: similars,
                            match: 10,
                            //image: entry.image[2]['#text'],
                            songs: new Array()
                        }
                        //station.artists.push(artist);
                        artists.push(artist);
                    }

                    if (onSuccess != null)
                        onSuccess(artists);
                });
            }

        }

        // 全アーティストのTopTracksを得る
        function loadTopTracks(isNew) {
            var played = false;
            var readyCount = 0;
            var artistCount = station.artists.length;

            station.artists.forEach(function (artist) {
                artist.songs = artist.songs || [];

                // 取得する曲数を求める（面倒くさいのできちんとページ単位で取得できる数にする）
                var countGet = artist.songCount || DEFAULT_SONG_COUNT;
                if ((countGet % DEFAULT_SONG_COUNT) != 0) {
                    countGet = Math.ceil(countGet / DEFAULT_SONG_COUNT) * DEFAULT_SONG_COUNT;
                }

                // ArtistのTopTracksを得る
                // 曲を取得している間にアーティストが追加・削除される可能性があるが特に問題はないと思われる
                // 成功・失敗に関わらずreadyCountはカウントする必要がある
                getTopTracks(artist, countGet, onSuccess, onError);
            });

            function onSuccess(artist, count) {
                ++readyCount;
                Debug.log("readyCount " + readyCount + ": " + artist.name + " " + artist.songs.length + "songs");

                if (isNew) {
                    // ステーションアーティストの曲を取得したら先頭の曲を再生する（YouTubeにある可能性が高い）
                    if (artist.name == station.artists[0].name && artist.songs.length > 0) {
                        cueVideo({ artist: artist.name, title: artist.songs[0].name }, CUEMODE.playCue);
                        played = true;
                    } else if (readyCount == 15 && !played) {
                        // ステーションアーティストの曲がなかなか取れない場合は諦める
                        cueVideo(getNextSong(), CUEMODE.playCue);
                    }
                } else {
                    // 最初に取得できたアーティストの曲を再生する
                    // （ステーションアーティストの曲をいつまでも待つということはしない）
                    if (readyCount == 1)
                        // 最初に取得できたアーティストの曲が連続してかかることが多いので、全アーティスト揃うまで待つことにした
                        //cueVideo(getNextSong(), CUEMODE.playCue);
                        cueVideo(getNextSong(), CUEMODE.play);
                    // 曲が全アーティス揃ったら次の曲を選ぶ（エラーで曲が取れない時もある）
                    if (readyCount == artistCount) {
                        cueVideo(getNextSong(), CUEMODE.cue);
                    }
                }

                // 最初の曲とのダブり回避のためには、最初の曲が再生されhistoryに置かれる必要がある。
                // 1）cueVideo関数でplayの後にcueをやる
                // 2) ポーリングでplayContext.trackCueに曲が入るのを待ってからcueVideoを呼ぶ
                // とりあえず、1の方法で行くことにする（ポーリングはあまりやりたくない）
                // ただし、全アーティス揃ってから次の曲を選ぶというのはできなくなる

                //if (readyCount == artistCount) {
                //    // 曲が全アーティス揃ったら次の曲を選ぶ（エラーで曲が取れない時もある）
                //    cueVideo(getNextSong(), CUEMODE.cue);
                //}
            }
            function onError(artist, count) {
                // 時間をおいて再トライしてみる
                window.setTimeout(function () {
                    getTopTracks(artist, count);
                }, Math.floor(Math.random() * 30000));
                onSuccess(artist);
            }
        }
        // 追加アーティスのTopTracksを得る
        function loadTopTracks2(startIndex) {
            for (var i = startIndex; i < station.artists.length; i++) {
                getTopTracks(station.artists[i], DEFAULT_SONG_COUNT,
                    function (artist, count) {
                        Debug.log("@" + artist.name + " " + artist.songs.length + "songs");
                    },
                    function (artist, count) {
                        // 時間をおいて再トライしてみる
                        window.setTimeout(function () {
                            getTopTracks(artist, count);
                        }, 3000);
                        Debug.log("@" + artist.name + " " + artist.songs.length + "songs");
                    });
            }
        }

        // 指定されたArtistのTopTracksを得る
        function getTopTracks(artist, count, onSuccess, onError) {

            // 面倒くさいのでcountはきちんとページ単位で取得できる数にする
            Debug.assert((count % DEFAULT_SONG_COUNT) == 0 && (artist.songs.length % count) == 0, "getTopTracks: illegal count=" + count);

            var page = Math.floor(artist.songs.length / count) + 1; // 開始ページ
            var limit = count;

            asService.getTopTracks(artist.name, page, limit, function (data) {
                if (data.error != null) {   // api が返すエラー
                    Debug.error("getTopTracks: " + data.error + " (artist=" + artist.name + ")\n\n" + data.message);
                } else if (data.toptracks == null) {
                    // toptracksプロパティが無い（取れない）時は何もしない
                    Debug.error("getTopTracks error: toptracks is undefined");
                } else {
                    var tracks = data.toptracks.track;
                    if (tracks && tracks.length > 0) { // 一応TopTracksがない場合も対応しておく

                        for (var i = 0; i < tracks.length; i++) {
                            artist.songs.push({
                                name: tracks[i].name,
                                playcount: tracks[i].playcount,
                            });
                        }
                        var total = data.toptracks['@attr'].total;      // アーティストの曲総数(max=1000)
                        artist.maxout = artist.songs.length >= total;   // これ以上曲があるかないか

                    } else {
                        // 曲が一曲しかない（tracksが配列ではない）か一曲もない場合
                        // 曲が一曲もない場合（エラーにもならず）、とりあえず曲名を空にして追加しておく
                        artist.songs.push({
                            name: tracks.name || '_',
                            playcount: tracks.playcount || 1,
                        });
                        artist.maxout = true;
                    }
                }
                if (onSuccess) {
                    onSuccess(artist, count);
                }
            }, function(){
                if (onError) {
                    onError(artist, count);
                }
            });
        }

        // 2つの配列から重複を除く
        // http://stackoverflow.com/questions/1187518/javascript-array-difference
        Array.prototype.diff = function (a, func) {
            return this.filter(function (i) { return !(func(a, i) > -1); });
        }
        // 条件に合った要素を検索する
        //Array.prototype.searchWith = function (compFn) {
        //    for (var i = 0; i < this.length; i++) {
        //        if (compFn(this[i]))
        //            return i;
        //    }
        //    return -1;
        //}

        function getNextSong() {

            // 1) artistsが空ならバッハのアリア          

            // 2) artistsからランダムでアーティストを選ぶ

            // 3) 選んだアーティストの曲を得る

            // 4) 曲からhistoryに重なる曲を除く（ただし総曲数がhistoryの数より少ない場合、historyの(総曲数－１)分だけ比較対象とする）
            //    曲が０になったなら artistsから (2)のアーティストを除いて (1)に戻る

            // 5) 4)からランダムで曲を選ぶ


            // プレイリスト再生中か？
            if (playlist != null && playlist.length > 0) {
                var track = playlist.shift();
                playlist.push(track);
                return track;
            }

            Debug.assert(station, "station not yet open");

            var bach_air = { artist: "Bach", title: "Air" };

            var artists = [];
            var songCount = 0;

            // favoritesを再生させるためartistとしてartistsにセットする
            var artist = { name: "$favorites", match: 10, songs: [] };
            favorites.forEach(function (entry) {
                if (entry.tags.indexOf(getStationId().id) != -1) {
                    artist.songs.push({
                        //artist: entry.track.artist,
                        //name: entry.track.title,
                        artist: entry.artist,
                        name: entry.title,
                        playcount: 1
                    });
                        
                    ++songCount;
                }
            });
            artist.songCount = songCount;
            artists.push(artist);
            Debug.log("お気に入りのきょくすう : ", songCount);

            // 再生する曲の総数を数える
            station.artists.forEach(function (artist) {
                if (artist.match > 0) { // artist.match = 0 のアーティストの曲は再生されないので除外する
                    artists.push(artist);

                    var count = Math.min(artist.songs.length, artist.songCount || DEFAULT_SONG_COUNT);
                    for (var i = 0; i < count; i++) {
                        var song = artist.songs[i];
                        if (!song.forbidden)
                            ++songCount;
                    }
                }
                //if (forbiddens.length > 0) {
                //    artist.songs.forEach(function (song) {
                //        //if (searchTrack(forbiddens, { artist: artist.name, title: song.name }) == -1)
                //        if (!song.forbidden)
                //            ++songCount;
                //    });
                //} else {
                //    songCount += artist.songs.length;
                //}
            });
            Debug.log("きょくすう : ", songCount);

            // 過去再生曲リストを作成
            var subhistory = history.slice(0, Math.min(history.length, songCount - 1));

            //for (var i = 0; i < subhistory.length; i++) {
            //    Debug.log((i + 1).toString() + ") subhistory: ", subhistory[i].title);
            //}
            //Debug.log("");

            // 1) artistsが空ならバッハのアリア  
            while (artists.length > 0) {

                // 2) artistsからランダムでアーティストを選ぶ
                var artist = selectArtist(artists);
                if (artist == null)
                    return bach_air;

                // 3) 選んだアーティストの曲を得る
                var songs = [];
                var songsSource = artist.songs;   // とりあえず

                var count = Math.min(songsSource.length, artist.songCount || DEFAULT_SONG_COUNT);
                for (var i = 0; i < count; i++) {
                    var song = songsSource[i];
                    songs.push({
                        artist: song.artist || artist.name,
                        title: song.name,
                        playcount: song.playcount,
                        forbidden: song.forbidden
                    });
                }
                //songsSource.forEach(function (song) {
                //    songs.push({
                //        artist: song.artist != null ? song.artist : artist.name,
                //        title: song.name,
                //        playcount: song.playcount,
                //        forbidden: song.forbidden
                //    });
                //});

                // 4) 曲からhistoryに重なる曲を除く

                //// まずYouTubeで再生できない曲を除く
                //songs = songs.diff(forbiddens, searchTrack);

                // 次に曲からhistoryに重なる曲を除く
                songs = songs.diff(subhistory, searchTrack);
                if (songs.length > 0) {

                    // 5) 4)からランダムで曲を選ぶ
                    var song = selectSong(songs);
                    if (song != null) {
                        Debug.log("getNextSong: [" + song.artist + " - " + song.title + "]");
                        return song;
                    }
                }
                else {
                    Debug.log("曲が０になったぞ！！！！ : " + artist.name);
                }

                // 再生できる曲がないなら artistsから、artistを除いて (1)に戻る
                artists.splice(artists.indexOf(artist), 1);
            }
            return bach_air;


            // アーティストを選ぶ
            function selectArtist(artists) {
                Debug.assert(artists.length > 0, "artists are empty");
                var artist;
                {
                    var sum = 0;
                    artists.forEach(function (artist) {
                        if (artist.songs != null &&
                            artist.songs.length > 0) // gettoptracksが失敗していると曲リストは空のまま
                            sum += parseFloat(artist.match);
                    });
                    if (sum == 0) { // 全アーティスト曲がない（可能性は低いが０％ではない）
                        return null;
                    }
                    var hit = Math.random() * sum;

                    sum = 0;
                    var i = -1;
                    do {
                        artist = artists[++i];
                        if (artist.songs.length > 0) // gettoptracksが失敗していると曲リストは空のまま
                            sum += parseFloat(artist.match);
                    } while (sum <= hit);
                }
                return artist;
            }

            // 曲を選ぶ
            function selectSong(songs) {
                Debug.assert(songs.length > 0, "songs are empty");
                var song;
                {
                    var sum = 0;
                    songs.forEach(function (song) {
                        if (!song.forbidden)    // forbiddenの曲は除く
                            sum += parseInt(song.playcount);
                    });
                    if (sum == 0) { // 再生できる曲がない
                        return null;
                    } else {
                        var hit = Math.floor(Math.random() * sum);

                        sum = 0;
                        var i = -1;
                        do {
                            song = songs[++i];
                            if (!song.forbidden)    // forbiddenの曲は除く
                                sum += parseInt(song.playcount);
                        } while (sum <= hit);
                    }
                }
                return song;
            }
        }

        // 指定された曲を準備（頭出し）する
        function cueVideo(track, cuemode, retry) {

            // 動画ＩＤマップに曲がある場合
            var key = track.artist + "-" + track.title;
            var value = idmap[key];
            if (value != null && value.id.length > 0) {
                //playVideo(value.id, cuemode);
                Debug.assert(value.id.length > 0, "cueVideo: video ID is empty!");
                playVideo({ id: value.id, stSec: value.stSec }, cuemode);
                return;
            }

            // 再生禁止リストにあるか？（ここでチェックするのが適切かどうかはまだわからん）
            if (cuemode != CUEMODE.play && searchTrack(donots, track) > -1) {
                Debug.error(" 再生禁止！ [" + track.artist + " - " + track.title + "]");
                addForbiddens(track);
                cueVideo(getNextSong(), cuemode);  // 別の曲にする
                return;
            }

            
            ytService.videoSearch(track, function (data) {
                if (data.error != null) {
                    Debug.error(" 動画検索エラー" +  + " - " + error.code + " " + error.message);
                    cueVideo(getNextSong(), cuemode);  // 別の曲にする
                    return;
                }

                //var videos = data.feed.entry;
                var videos = data;

                // エントリがない（見つからない？）
                if (videos == null || videos.items == null ||
                    videos.items.length == 0 ||
                    videos.pageInfo == null || videos.pageInfo.totalResults == 0) {
                    Debug.error(" エントリがない [" + track.artist + " - " + track.title + "]");
                    addForbiddens(track);
                    cueVideo(getNextSong(), cuemode);  // 別の曲にする
                    return;
                }

                var index = 0;

                // とりあえずVidoIDではじく（=addDonotByIdを使用）のはやめたのでので必要ない
                //// 再生禁止リストにあるか？（VideoIDをチェックする）
                //for ( ; index < videos.length; index++) {
                //    track.videoId = videos[index]['media$group']['yt$videoid']['$t'];
                //    if (searchTrack(donots, track) == -1)
                //        break;
                //    Debug.error(" 再生禁止！ [" + track.videoId + "]");
                //}
                //if (index >= videos.length) {
                //    cueVideo(getNextSong(), cuemode);  // 別の曲にする
                //    return;
                //}

                //// 埋め込み拒否、「歌ってみた」「演奏してみた」かどうかのチェック
                //// ※同時にチェックしないといけない
                //while (true) {
                //    var noembed = videos[index]['yt$noembed'];
                //    var id = videos[index]['media$group']['yt$videoid']['$t'];
                //    var videoTitle = videos[index]['title']['$t'];

                //    if (noembed) {
                //        Debug.error("埋め込み拒否動画 (" + id + ") [" + videoTitle + "]");
                //    } else if (videoTitle.indexOf("てみた") != -1) {
                //        Debug.error("してみた動画 (" + id + ") [" + videoTitle + "]");
                //    } else {
                //        break;  // 埋め込み拒否でもなく、「歌ってみた」「演奏してみた」でもない
                //    }

                //    if (++index >= videos.length) {
                //        addForbiddens(track);
                //        cueVideo(getNextSong(), cuemode);  // 諦めて別の曲にする
                //        return;
                //    }
                //}

                //// 埋め込み拒否か？
                //while (videos[index]['yt$noembed'] != null) {
                //    Debug.error("埋め込み拒否動画 (" + videos[index]['media$group']['yt$videoid']['$t'] +
                //        ") [" + videos[index]['title']['$t'] + "]");
                //    if (++index >= videos.length) {
                //        addForbiddens(track);
                //        cueVideo(getNextSong(), cuemode);  // 諦めて別の曲にする
                //        return;
                //    }
                //}

                // 「歌ってみた」「演奏してみた」？
                var indexBak = index;
                //while (videos[index]['title']['$t'].indexOf("てみた") != -1) {
                while (videos.items[index].snippet.title.indexOf("てみた") != -1) {
                    Debug.error(videos.items[index].snippet.title);
                    if (++index >= videos.length) {
                        index = indexBak;
                        //break;  // 諦める
                        cueVideo(getNextSong(), cuemode);  // 諦めて別の曲にする
                        return;
                    }
                }

                //// 短すぎる/長すぎる曲は再生しない？
                //var duration = videos[index]['media$group']['yt$duration'].seconds;
                //if (duration < 10) {
                //    Debug.error("短すぎる動画 (" + videos[index]['media$group']['yt$videoid']['$t'] +
                //        ") [" + duration + "]");
                //    cueVideo(getNextSong(), cuemode);  // 別の曲にする
                //    return;
                //}


                // 再生するyoutubeの動画idを取得
                //var id = videos[index]['media$group']['yt$videoid']['$t'];
                //var videoTitle = videos[index]['title']['$t'];
                var id = videos.items[index].id.videoId;
                var videoTitle = videos.items[index].snippet.title;

                //playVideo(id, cuemode, videoTitle);
                playVideo({ id: id, title: videoTitle }, cuemode);
            }, function () {
                // サーバーエラー (YouTube Data api)
                // 500（内部エラー）
                // 503（サービスが利用できない）
                if (!retry) {
                    cueVideo(getNextSong(), cuemode, true);  // 別の曲にする
                }

                //if (!retry) {
                //    window.setTimeout(function () {
                //        cueVideo(track, cuemode, true);  // retry after a while
                //    }, 2000);
                //}
            });

            //function playVideo(id, cuemode, videotrack) {
            function playVideo(video, cuemode) {
                if (cuemode != CUEMODE.cue) {
                    // すぐに再生する
                    player.playVideo(video.id, video.stSec);
                    playContext.trackPlay = { artist: track.artist, title: track.title, videoId: video.id };
                    setHistory(playContext.trackPlay);
                    $rootScope.title = playContext.trackPlay.title + " - " + playContext.trackPlay.artist;
                    Debug.info("loadVideoById (" + video.id + ") [" + video.title + "]");

                    // 次の曲の準備
                    if (cuemode == CUEMODE.playCue)
                        cueVideo(getNextSong(), CUEMODE.cue);
                }
                else {
                    // 次に再生するための読み込み(頭出し）
                    player.cueVideo(video.id, video.stSec, function () {
                        // 頭出しが完了したらやる処理
                        playContext.trackCue = { artist: track.artist, title: track.title, videoId: video.id };
                        Debug.info("cueVideoById (" + video.id + ")  YouTube title [" + video.title + "]");
                        if (!$rootScope.$$phase)
                            $rootScope.$apply();    // これをやらないとViewが更新されない
                    });
                }
            }
        }

        // 指定された曲を準備（頭出し）する（ＩＤ指定）
        function cueVideo2(id, cuemode, track) {
        }

        // YouTubeプレーヤーのステータス変更時の処理
        function onStateChange(state) {
            Debug.log("すてーとチェンジドーーー[" + state + "]");

            playContext.playerState = state;    // とりあえず
            playContext.isPlaying = (state == 1);
            if (!$rootScope.$$phase)
                $rootScope.$apply();    // これをやらないとViewが更新されない

            if (state == 0) {    // 再生終了？
                if (settings.repeat)
                    player.rewind();
                else
                    playNext();
            }
        }
        // YouTubeプレーヤーのエラー時の処理
        function onPlayerError(state) {
            if (state == 5) {    // 再生できない？
            }
        }
        // 次の曲に移行する
        function playNext(mandatory) {
            if (playContext.trackCue) {
                player.doNext(mandatory);
                playContext.trackPlay = playContext.trackCue;
                playContext.trackCue = null;
                setHistory(playContext.trackPlay);
                $rootScope.$broadcast("MusicChanged", playContext.trackPlay);

                // 次の曲の準備
                if (station) {
                    //window.setTimeout(function () {
                    cueVideo(getNextSong(), CUEMODE.cue);
                    //}, 1000);
                }
            } else {
                if (station) {
                    // ステーションは開いているのに、songCueが空の時（通常ありえない）
                    cueVideo(getNextSong(), CUEMODE.play);
                }
            }
        }

        service.doNext = function () {
            playNext(true);
        }

        service.pause = function () {
            player.pause();
        }

        service.getPlaybackStatus = function () {
            return player.playbackStatus();
        }

        service.playNow = function (artist, title) {
            cueVideo({ artist: artist, title: title }, CUEMODE.play);
        }

        service.artists = function () {
            return station.artists;
        }

        service.playContext = function () {
            return playContext;
        }

        service.history = function () {
            return history;
        }

        function setHistory(track) {
            Debug.assert(track, "setHistory: track is null!");
            history.unshift({ artist: track.artist, title: track.title });  // とりあえずvideoIdは含めない
            if (history.length > HISTORY_SIZE)
                history.pop();
            saveHistory();
        }


        service.favorites = function () {
            return favorites;
        }

        function addFavorite(track) {
            //var index = indexOf(track);
            var index = searchTrack(favorites, track);
            if (index >= 0) {
                // 既にあるなら現ステーションをtagとして登録
                var stationId = getStationId();
                if (stationId){
                    var id = stationId.id;
                    if (favorites[index].tags.indexOf(id) >= 0)
                        return;
                    favorites[index].tags.push(id);
                }
            } else {
                // 新規に追加
                //var entry = { track: track, tags: [getStationId().id] }
                var entry = {
                    artist: track.artist,
                    title: track.title,
                    tags: []
                }
                var stationId = getStationId();
                if (stationId)
                    //entry.tags = [stationId.id]
                    entry.tags.push(stationId.id);
                //favorites.push(entry);
                favorites.unshift(entry);
            }
            saveFavorites();

            // 指定された曲がリストにあればそのインデックスを返す（ダブりチェック用）
            //function indexOf(track) {
            //    for (var i = 0; i < favorites.length; i++) {
            //        var value = favorites[i].track;
            //        if (value.artist == track.artist && value.title == track.title) {
            //            return i;
            //        }
            //    }
            //    return -1;
            //}
        }

        service.addFavorite = function (track) {
            if (track == null)
                track = history[0];
            addFavorite(track);
        }

        // お気に入りへの登録（YouTube VideoID, タイトル指定）
        service.addFavoriteAs = function (id, track, onSuccess, onError) {
            Debug.assert(onSuccess && onError, "addFavoriteAs: success & error function required");

            service.getVideoTitle(id, function (videoTitle) {
                if (track == null || track.title.length == 0)
                    track = { artist: "_", title: videoTitle };  // アーティスト名は空にはしない

                // お気に入りへの登録
                if (searchTrack(favorites, track) == -1) {
                    addFavorite(track);

                    // id <-> track 変換テーブルへの登録
                    service.setVideoId(track, id);
                }

                onSuccess(track);

            }, function (errmsg) {
                onError(errmsg);
            });
        }

        // 動画タイトルの取得（指定されたIDの動画が存在するかどうかのチェック）
        service.getVideoTitle = function(id, onSuccess, onError) {
            Debug.assert(onSuccess && onError, "getVideoTitle: success & error function required");
            ytService.getInfo(id, function (data) {
                var entry = data.entry;
                Debug.dir(entry);

                // エントリがない（見つからない？）
                if (entry == null) {
                    Debug.error(" エントリがない [" + id + "]");
                    onError("Video not found");
                    return;
                    // Viewのメッセージエリアにエラー表示するといった処理が必要
                }

                // 埋め込み拒否か？
                if (entry['yt$noembed'] != null) {
                    Debug.error("埋め込み拒否動画 (" + id + ") [" + entry['title']['$t'] + "]");
                    onError("Embedding disabled by request");
                    return;
                    // Viewのメッセージエリアにエラー表示するといった処理が必要
                }

                // 動画タイトルを取得
                var title = entry['title']['$t'];

                onSuccess(title);

            }, function (status) {    // error
                if (status == '400' || status == '404')
                    onError("Video not found");
                else
                    onError("server error");
            });
        }

        //service.removeFavorite = function (index) {
        //    // favoritesのtagから現ステーションIDを削除する
        //    var entry = favorites[index];
        //service.removeFavorite = function (entry) {
        //    // favoritesのtagから現ステーションIDを削除する
        //    var tagidx = entry.tags.indexOf(getStationId().id);
        //    if (tagidx != -1) {
        //        entry.tags.splice(tagidx, 1);
        //    }
        //    // tagが空になったらfavoritesからその要素を削除する
        //    if (entry.tags.length == 0) {
        //        var index = searchTrack(favorites, entry);
        //        favorites.splice(index, 1);
        //    }
        //    saveFavorites();
        //}
        service.removeFavorite = function (entry, deleteEntry) {
            if (deleteEntry) {
                // favoritesからその要素を削除する
                var index = searchTrack(favorites, entry);
                favorites.splice(index, 1);
                saveFavorites();
            } else {
                // favoritesのtagから現ステーションIDを削除する
                var tagidx = entry.tags.indexOf(getStationId().id);
                if (tagidx != -1) {
                    entry.tags.splice(tagidx, 1);
                    saveFavorites();
                }
            }
        //    if (!service.isEmpty()) {
        //        // favoritesのtagから現ステーションIDを削除する
        //        var tagidx = entry.tags.indexOf(getStationId().id);
        //        if (tagidx != -1) {
        //            entry.tags.splice(tagidx, 1);
        //        }
        //    } else {
        //        // ステーションが一つもない状態なら要素を削除する
        //        var index = searchTrack(favorites, entry);
        //        favorites.splice(index, 1);
        //    }
        //    saveFavorites();
        }


        service.donots = function () {
            return donots;
        }

        function addDonot(track) {
            if (searchTrack(donots, track) == -1) {
                //donots.push({ artist: track.artist, title: track.title });
                donots.unshift(track);
                saveDonots();
            }
        }

        service.addDonot = function (track) {
            if (track == null)
                track = history[0];
            addDonot(track);
        }

        service.addDonotById = function (id) {
            if (id == null)
                id = playContext.trackPlay.videoId;
            service.getVideoTitle(id, function (videoTitle) {
                var track = { artist: "_", title: videoTitle, videoId: id };  // アーティスト名は空にはしない
                addDonot(track);
            }, function (errmsg) {
                // とりあえず何もしない
            });
        }

        service.removeDonot = function (entry) {
            var index = searchTrack(donots, entry);
            donots.splice(index, 1);
            saveDonots();
        }

        // お気に入りの曲をプレイリストに入れて再生する
        service.playFavorites = function () {
            if (favorites.length == 0)
                return;
            if (playlist != null)
                return;


            delete settings.stationId;
            saveSettings();
            station = null; // ステーションを閉じる（これでいいのか？）
            $rootScope.$broadcast("StationChanged");

            
            playlist = angular.copy(favorites);

            // shuffle
            var i = playlist.length;
            while (--i) {
                var j = Math.floor( Math.random() * ( i + 1 ) );
                var tmp = playlist[i]
                playlist[i] = playlist[j];
                playlist[j] = tmp;
            }

            cueVideo(getNextSong(), CUEMODE.play);
            cueVideo(getNextSong(), CUEMODE.cue);
        }

        service.readThumbnails = function () {
            readThumbnails();
        }

        function readThumbnails() {
            favorites.forEach(function (track) {
                if (track.thumbnail == null) {
                //var id = service.getVideoId(track);
                //if (id && track.thumbnail == null) {
                    //ytService.getInfo(id, function (data) {
                    //    var entry = data.feed.entry;
                    //    Debug.dir(entry);

                    //    // エントリがない（見つからない？）
                    //    if (entry == null) {
                    //        Debug.error(" エントリがない [" + id + "]");
                    //        return;
                    //    }

                    //    // 埋め込み拒否か？
                    //    while (entry[0]['yt$noembed'] != null) {
                    //        Debug.error("埋め込み拒否動画 (" + id + ") [" + entry[0]['title']['$t'] + "]");
                    //        return;
                    //    }


                    //    // サムネイルを取得
                    //    var thumbnail = entry[0]['media$group']['media$thumbnail'][1].url;
                    //    Debug.log("サムネイル : ", thumbnail);
                    //    track.thumbnail = thumbnail;
                    //});

                    asService.getInfo(track.artist, function (data) {
                        Debug.dir(data);
                        if (data.error != null) {   // api が返すエラー
                            Debug.error("artist.search error:" + data.error + "[" + data.message + "]");
                            return;
                        }

                        // サムネイルを取得
                        track.thumbnail = data.artist.image[0]['#text'];
                        Debug.log("サムネイル : ", track.thumbnail);
                    });
                }

            });
        }

        // プレーヤー設定
        service.playerSettings = function (s) {
            if (s) {
                Debug.assert(!(s.crossFade && s.repeat), "can't set enable crossFade & repeat at the same time");
                if (s.hasOwnProperty("crossFade")) {
                    settings.crossFade = s.crossFade;
                    saveSettings();
                    player.crossFade(s.crossFade);
                }
                if (s.hasOwnProperty("repeat")) {
                    settings.repeat = s.repeat;
                    saveSettings();
                }
            }
            return { crossFade: settings.crossFade, repeat: settings.repeat };
        }

        // デバッグ用
        service.debug = function () {
            player.debug();
        }

        return service;
    }]);


function AudioscrobblerService($http) {

    // 指定されたアーティストに似たアーティス(SimilarArtist)を得る
    this.getSimilarArtists = function (artistName, count, onSuccess, onError) {
        var uri = 'http://ws.audioscrobbler.com/2.0/?method=artist.getsimilar&artist='
            + encodeURIComponent(artistName)
            + '&limit=' + count.toString()
            + '&autocorrect=1'
            + '&api_key=031d7fac215b370e7179b8354a2f7f77'
            + '&format=json'
            + '&callback=JSON_CALLBACK';
        $http.jsonp(uri).
            success(onSuccess).
            error(function (data, status, headers, config) {
                // called asynchronously if an error occurs
                // or server returns response with an error status.
                // 503 etc.
                Debug.error("$http.jsonp error [artist.getsimilar]\n\n" + config.url);
                if (onError != null)
                    onError();
            });
    }

    // 指定されたArtistのTopTracksを得る
    this.getTopTracks = function (artist, page, limit, onSuccess, onError) {
        var uri = 'http://ws.audioscrobbler.com/2.0/?method=artist.gettoptracks&artist='
            + encodeURIComponent(artist)
            + '&page=' + page.toString()
            + '&limit=' + limit.toString()
            + '&api_key=031d7fac215b370e7179b8354a2f7f77'
            + '&format=json'
            + '&callback=JSON_CALLBACK';
        $http.jsonp(uri).
            success(onSuccess).
            error(function (data, status, headers, config) {
                // called asynchronously if an error occurs
                // or server returns response with an error status.
                // 503 etc.
                Debug.error("$http.jsonp error [artist.gettoptracks]\n\n" + config.url);
                if (onError != null)
                    onError();
            });
    }

    // 指定された曲の検索
    this.searchTrack = function (title, page, limit, onSuccess, onError) {
        var uri = 'http://ws.audioscrobbler.com/2.0/?method=track.search&track='
            + encodeURIComponent(title)
            //+ '&artist=' + encodeURIComponent(artistName)
            + '&page=' + page.toString()
            + '&limit=' + limit.toString()
            + '&api_key=031d7fac215b370e7179b8354a2f7f77'
            + '&format=json'
            + '&callback=JSON_CALLBACK';
        $http.jsonp(uri).
            success(onSuccess).
            error(function (data, status, headers, config) {
                // called asynchronously if an error occurs
                // or server returns response with an error status.
                // 503 etc.
                Debug.error("$http.jsonp error [track.search]\n\n" + config.url);
                if (onError != null)
                    onError();
            });
    }

    // アーティストの情報を得る
    this.getInfo = function (artist, onSuccess, onError) {
        var uri = 'http://ws.audioscrobbler.com/2.0/?method=artist.getInfo&artist='
            + encodeURIComponent(artist)
            + '&autocorrect=1'
            + '&api_key=031d7fac215b370e7179b8354a2f7f77'
            + '&format=json'
            + '&callback=JSON_CALLBACK';
        $http.jsonp(uri).
            success(onSuccess).
            error(function (data, status, headers, config) {
                // called asynchronously if an error occurs
                // or server returns response with an error status.
                // 503 etc.
                Debug.error("$http.jsonp error [artist.getInfo]\n\n" + config.url);
                if (onError != null)
                    onError();
            });
    }

    // アーティストの検索
    this.getArtist = function (artist, onSuccess, onError) {
        var uri = 'http://ws.audioscrobbler.com/2.0/?method=artist.search&artist='
            + encodeURIComponent(artist)
            + '&api_key=031d7fac215b370e7179b8354a2f7f77'
            + '&format=json'
            + '&callback=JSON_CALLBACK';
        $http.jsonp(uri).
            success(onSuccess).
            error(function (data, status, headers, config) {
                // called asynchronously if an error occurs
                // or server returns response with an error status.
                // 503 etc.
                Debug.error("$http.jsonp error [artist.search]\n\n" + config.url);
                if (onError != null)
                    onError();
            });
    }

}

function YouTubeService($http) {

    // 指定された名前の曲で動画検索
    this.videoSearch = function (track, onSuccess, onError) {
        search(track, true, onSuccess, onError);
    }

    // 動画情報の取得
    this.getInfo = function (videoId, onSuccess, onError) {
        //var uri = 'http://gdata.youtube.com/feeds/api/videos/'
        //+ videoId
        //+ '?&alt=json';
        ////+ '&callback=JSON_CALLBACK';
        var uri = 'https://www.googleapis.com/youtube/v3/videos/'
        + '?part=snippet'
        + '&id=' + videoId
        + '&key=AIzaSyDTgBSjmchn_levHkOLJm-d6AfhIBOTPWU'
        // エラー発生原因（Bad Request(400):'Invalid id', Not Found(404):'Video not found'）を知りたいのでJQueryを使う。
        // $httpでエラー発生原因を得る方法が分からない（上記のエラーでもstatusは０になる）
        $.ajax({
            url: uri,
            cache: false,
            //dataType: 'jsonp',
            success: function (data, textStatus, jqXHR) {
                if (onSuccess)
                    onSuccess(data);
            },
            error: function (jqXHR, textStatus, errorThrown) {
                Debug.dir(jqXHR);
                if (onError)
                    onError(jqXHR.status);  // '400','404'
            },
        });

        //$http.jsonp(uri).success(function(data, status, headers, config) {
        //    // this callback will be called asynchronously
        //    // when the response is available
        //    if (onSuccess)
        //        onSuccess(data);
        //}).
        //error(function(data, status, headers, config) {
        //    // called asynchronously if an error occurs
        //    // or server returns response with an error status.
        //    if (onError)
        //        onError(data);
        //});
    }

    // 動画検索
    // http://gdata.youtube.com/feeds/api/videos/?q=%E6%81%8B%E6%84%9B%E3%82%B5%E3%83%BC%E3%82%AD%E3%83%A5%E3%83%AC%E3%83%BC%E3%82%B7%E3%83%A7%E3%83%B3+%E8%8A%B1%E6%BE%A4%E9%A6%99%E8%8F%9C&oq=%E6%81%8B%E6%84%9B%E3%82%B5%E3%83%BC%E3%82%AD%E3%83%A5%E3%83%AC%E3%83%BC%E3%82%B7%E3%83%A7%E3%83%B3+%E8%8A%B1%E6%BE%A4%E9%A6%99%E8%8F%9C&alt=json
    function search(track, exact, onSuccess, onError) {
        var query;
        if (exact) { // 検索を厳格（アーティストの完全一致）にする？
            if (track.artist.indexOf(' ') != -1) {
                query = '"' + track.artist + '"' + " " + track.title;
            } else {
                query = track.artist + " " + track.title;
            }
        } else {
            query = track.artist + " " + track.title;
            query = query.replace(/(\(.*\)|\[.*\])/g, "");   // 括弧()[]を削除
        }
        //query += " -てみた -カラオケ";
        //query += " -てみた";
        //var uri = 'http://gdata.youtube.com/feeds/api/videos/-/music?q='
        //var uri = 'http://gdata.youtube.com/feeds/api/videos/?q='
        var uri = 'https://www.googleapis.com/youtube/v3/search'
        + '?part=snippet'
        + '&type=video'
        + '&videoEmbeddable=true'
        + '&q=' + encodeURIComponent(query)
        + '&key=AIzaSyDTgBSjmchn_levHkOLJm-d6AfhIBOTPWU'
        + '&callback=JSON_CALLBACK';

        ////+ encodeURIComponent(query)
        ////+ '&start-index=1'
        ////+ '&max-results=5'
        //+ '&alt=json'
        ////+ '&alt=json-in-script'
        ////+ '&format=5' // filter out non-embeddable videos
        //+ '&v=2'
        //+ '&callback=JSON_CALLBACK';
        $http.jsonp(uri).
            success(function (data) {
                Debug.log("youtube video search: [" + query + "]");

                //// エントリがない（見つからない？）
                //if (data.feed.entry == null && exact) {
                //    search(track, false, onSuccess, onError);    // 検索条件をゆるくして再検索
                //    return;
                //}
                onSuccess(data);
            }).
            error(function (data, status, headers, config) {
                // called asynchronously if an error occurs
                // or server returns response with an error status.
                // 503 etc.
                Debug.error("$http.jsonp error [youtube videoSearch]\n\n" + config.url);
                if (onError != null)
                    onError();
            });

    }
}

function YouTubePlayer(onPlayerReadyFunc, onStateChangeFunc, onErrorFunc) {

    // Load player api asynchronously.
    var tag = document.createElement('script');
    tag.src = "https://www.youtube.com/player_api";
    var firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    var player;
    var playerSub;
    var crossFade;
    var timer;
    var volumebak = -1;
    var html5player;    // true: HTML5, false:Flash
    var eventMap = {};  // events on player state changed   // とりあえずplyaerSubのみ


    window.onYouTubePlayerAPIReady = function () {

        player = new YT.Player('player1', {
            //height: '270',
            //width: '480',
            height: '230',
            width: '350',
            playerVars: {
                "rel": 0,            // 関連動画を読み込まない
                wmode: "opaque"
            },
            events: {
                'onReady': onPlayerReady,
                'onStateChange': onPlayerStateChange,
                'onError': onPlayerError
            }
        });
        playerSub = new YT.Player('player2', {
            height: '230',
            width: '350',
            playerVars: {
                "rel": 0,            // 関連動画を読み込まない
                wmode: "opaque"
            },
            events: {
                'onReady': onPlayerReady,
                'onStateChange': onPlayerStateChange,
                'onError': onPlayerError
            }
        });

        // scopeを得る // $rootScopeを使うので必要なくなった
        //scope = angular.element(mainCtrl).scope();
    }

    function onPlayerReady(evt) {
        if (evt.target == player) {
            evt.target.setVolume(100);  // 音量 0～100 
            evt.target.ready = true;
            //player.a.style.display = "none"
            evt.target.id = "player1";
        } else {
            evt.target.setVolume(100);  // 音量 0～100 
            evt.target.ready = true;
            //playerSub.a.style.display = "none"
            evt.target.id = "player2";
        }

        // 両playerがreadyになったか？
        if (player.ready && playerSub.ready) {

            // HTML5 or Flash?
            var rates = player.getAvailablePlaybackRates();
            Debug.log("YouTube Player playbackRates=", rates);
            html5player = rates.length > 1;
            Debug.info("----------", html5player? "HTML5 Player": "Flash Player");
            Debug.info("---status player:" + player.getPlayerState() + "  playerSub:" + playerSub.getPlayerState());

            if (onPlayerReadyFunc)
                onPlayerReadyFunc();

            if (crossFade) {
                timer = window.setTimeout(onTimeout, 1000);
            }
        }
    }

    function onPlayerStateChange(evt) {
        /*
           -1 (未スタート、他の動画に切り替えた時など)
           0 (再生終了（＝最後まで再生した）)
           1 (再生中)
           2 (一時停止された)
           3 (バッファリング中)
           5 (頭出しされた)
        */
        if (evt.target == player) {
            Debug.info("player status (" + evt.data + ")");

            // cross-fade時に、YouTube Playerの中で操作された時の対応
            // ※正直ノイズが乗ったりする原因にもなるので、なくてもいいかもしれない。。。
            if (crossFade && volumebak != -1) {   // 'cross-fade' started?
                Debug.info("----- playerSub=" + playerSub.getPlayerState());
                if (evt.data == 2 && playerSub.getPlayerState() != 2) {
                    // player終了時は 1->2->0 となるが
                    // 2->0が直ぐに起きる（ここでplayerSubをpauseしてもgetPlayerStateに反映されない位）ので
                    // 操作されて２になったのか、終了のため２になったのかをtimerを使って判断することにした。
                    window.setTimeout(function () {
                        if (player.getPlayerState() == 2) {
                            Debug.info("----- pauseが押されたと判断した");
                            playerSub.pauseVideo();
                            playerSub.paused = true;    // getPlayerStateはすぐに反映されないので
                        }
                    }, 400);    // 小さい値だと捉えそこなう（大きすぎるとpauseだった時、反応が遅れる）
                }
                if (evt.data == 1 && playerSub.getPlayerState() != 1) {
                    playerSub.playVideo();
                    playerSub.paused = false;
                }
                if (evt.data == 0 && playerSub.paused) { // たまに上の処理で捉えられない時があるので
                    // この処理を行うと必ずノイズというか音飛びのような現象が発生する
                    Debug.info("----- pauseが押されたと判断したのは間違いだった");
                    playerSub.playVideo();
                    playerSub.paused = false;
                }
            }

            if (onStateChangeFunc)
                onStateChangeFunc(evt.data);
        } else {
            Debug.info("playerSub status (" + evt.data + ")");

            //// cross-fade処理は、playerSubが1になってから始める
            //if (crossFade && volumebak != -1 && evt.data == 1 && !playerSub.paused) {
            //    Debug.log("ーーーークロスフェイド開始ーーーー volumebak=", volumebak);
            //    timer = window.setTimeout(onTimeout2, 100);    // ここの秒数は要調整
            //}

            // とりあえず
            var func = eventMap[evt.data];
            if (func)
                func();
        }
    }
    function waitStateChange(state, stateChangeCB, timeoutCB) {
        Debug.assert(state && stateChangeCB && timeoutCB, "waitStateChange: illegal parameter");
        //if (playerSub.getPlayerState() == state) {    // 既にstateになっている
        //    stateChangeCB();
        //    return;
        //}
        eventMap[state] = function () {
            window.clearTimeout(internalTimer);
            delete eventMap[state];
            stateChangeCB();
        }
        var internalTimer = window.setTimeout(function () {
            delete eventMap[state];
            timeoutCB();
        }, 4000);   // 要調整
    }

    function onPlayerError(evt) {
        /* 
           2:      無効なパラメータが含まれている（動画IDが間違っている場合など）
           5:      再生できません
           100:   動画が見つかりません（動画が削除されている、プライベート動画など）
           101:   所有者により埋め込みが禁止されている動画
           150:   101と同じ
        */
        if (evt.target == player) {
            Debug.error("onPlayerError at player: " + evt.data);
            if (onErrorFunc)
                onErrorFunc(evt.data);
        } else {
            Debug.error("onPlayerError at playerSub: " + evt.data);
        }
    }

    function onTimeout() {
        var sec = player.getCurrentTime();
        var fadeSec = player.getDuration() - 11;
        if (sec >= fadeSec && player.getPlayerState() == 1 &&
            (playerSub.getPlayerState() == 2 || playerSub.getPlayerState() == 5)) {
            //playerSub.playVideo();
            volumebak = player.isMuted()? playerSub.getVolume(): player.getVolume();    // 両方ともmuteされていたら。。。
            playerSub.setVolume(0);

            Debug.log("ーーもうすぐクロスフェイド開始ーー volumebak=", volumebak);
            playerSub.playVideo();

            // １になるのを待ってからクロスフェイド用タイマーを起動する
            Debug.log(">>>>>>> 1 待ち ");
            waitStateChange(1, function () {
                Debug.log("ーーーークロスフェイド開始ーーーー volumebak=", volumebak);
                timer = window.setTimeout(onTimeout2, 100);    // ここの秒数は要調整
            }, function () {
                // １にならなかったらクロスフェイドは諦める（ありえないと思うが）
                Debug.log("<<<<<<< 1 タイムアウト");
            });

            //timer = window.setTimeout(onTimeout2, 1000);  // -> onPlayerStateChange
        } else {
            timer = window.setTimeout(onTimeout, 1000);
        }
    }
    function onTimeout2() {
        var volume = player.getVolume();
        if (volume > 0) {
            if (player.getPlayerState() == 1) {
                volume -= (volumebak / 10);
                Debug.log("volume=" + volume);
                player.setVolume(volume);
                playerSub.setVolume(volumebak - volume);
            }
            timer = window.setTimeout(onTimeout2, 1000);
        }
    }
    function onPlayerSwapped() {
        if (crossFade) {
            // cross-fade時はplayerのstatechange(1)が起きないのでここで送ってやる
            if (playerSub.getPlayerState() != 5) {  // statechange(1)が既に送られたかどうかの判断
                window.setTimeout(function () {
                    if (onStateChangeFunc)
                        onStateChangeFunc(1);
                }, 0);
            }
            cancelFade();
            timer = window.setTimeout(onTimeout, 1000);
        }
    }
    function cancelFade() {
        window.clearTimeout(timer);
        if (volumebak != -1) {   // 'cross-fade' started?
            player.setVolume(volumebak);
            playerSub.setVolume(volumebak);
            //playerSub.mute();
            Debug.log("ーーーークロスフェイド終了ーーーー volumebak=", volumebak + ", vol=" + player.getVolume());
            volumebak = -1;
        }
    }

    function playNext() {
        Debug.log("プレーヤー切り替え");
        //player.pauseVideo();
        swapPlayer();
        if (player.getPlayerState() != 1) 
            player.playVideo();
        onPlayerSwapped()
    }
    function swapPlayer() {
        //var volume = player.getVolume();
        var temp = player;
        player = playerSub;
        playerSub = temp;
        //if (volume != 0)    // mute動画の場合もある
        //    player.setVolume(volume);

        //if (playerSub.a.style.position == "absolute") {
        //    player.a.style.position = "absolute"
        //    player.a.style.left = "0"
        //    playerSub.a.style.position = "static"
        //}
        if (document.getElementById(playerSub.id).style.position != "static") {
            document.getElementById(player.id).style.position = "absolute"
            document.getElementById(player.id).style.left = 0
            document.getElementById(playerSub.id).style.position = "static"
        }
    }

    this.playVideo = function (id, stSec) {
        if (crossFade) {
            if (playerSub.getPlayerState() == 1) {
                playerSub.seekTo(0);
                playerSub.pauseVideo();
            }
            cancelFade();
            timer = window.setTimeout(onTimeout, 1000);
        }
        player.loadVideoById(id, stSec);
    }
    this.cueVideo = function (id, stSec, completeCb) {
        // HTML5 Player 対応
        if (!html5player) {
            //playerSub.mute();
            playerSub.cueVideoById(id, stSec);
            //playerSub.playVideo();
            //playerSub.pauseVideo();
            //playerSub.unMute();
            onComplete();   // 1か2を待つべきかもしれないがとりあえず
        } else {
            playerSub.mute();
            playerSub.cueVideoById(id, stSec);
            Debug.log(">>>>>>> 5 待ち ");
            waitStateChange(5, function () {
                playerSub.playVideo();  // seekTo(0)だとおかしな動きになる(Win7 IE HTML5)
                Debug.log(">>>>>>> 1 待ち ");    // 1を待ってからpauseしないとstate=2にならない(IE)
                waitStateChange(1, function () {
                    playerSub.pauseVideo();
                    playerSub.unMute();
                    onComplete();
                }, function () {
                    Debug.log("<<<<<<< 1 タイムアウト");
                    playerSub.pauseVideo();
                    playerSub.unMute();
                    onComplete();
                });
            }, function () {
                Debug.log("<<<<<<< 5 タイムアウト");
                playerSub.unMute();
                onComplete();
            });
        }

        function onComplete() {
            if (completeCb)
                completeCb();
        }
    }
    this.doNext = function (mandatory) {   // on air <- stand by
        //if (mandatory) {    // ボタン操作？
        //    Debug.log("ーーーーＮＥＸＴボタンが押されたーーーー vol=", player.getVolume());
        //    if (player.getPlayerState() == 1) {
        //        player.pauseVideo();    // 一旦止める
        //    }
        //    if (crossFade && volumebak != -1) {   // 'cross-fade' started?
        //        playNext(); // cross-fadeが始まっていた場合、volumeはここでリセットされる
        //    } else {
        //        var volume = player.getVolume();
        //        playNext();
        //        if (volume != 0)    // mute動画の場合もある
        //            player.setVolume(volume);
        //    }
        //} else {
        //    playNext();
        //}
        if (player.getPlayerState() == 1)
            player.pauseVideo();    // 一旦止める

        if (crossFade && volumebak != -1) {   // 'cross-fade' started?
            playNext(); // cross-fadeが始まっていた場合、volumeはここでリセットされる
        } else {
            var volume = player.getVolume();
            playNext();
            if (volume != 0)    // mute動画の場合もある
                player.setVolume(volume);
        }
    }
    this.rewind = function () {
        player.seekTo(0);
    }
    this.pause = function () {
        if (crossFade && volumebak != -1) {   // 'cross-fade' started?
            if (player.getPlayerState() == 1) {
                player.pauseVideo();
                if (playerSub.getPlayerState() == 1) 
                    playerSub.pauseVideo();
            } else {
                player.playVideo();
                if (playerSub.getPlayerState() == 2) 
                    playerSub.playVideo();
            }
        } else {
            if (player.getPlayerState() == 1)
                player.pauseVideo();
            else
                player.playVideo();
        }
    }
    this.stop = function () {
        player.stopVideo();
    }
    this.cancel = function () {
        player.stopVideo();
        playerSub.stopVideo();
    }
    this.playbackStatus = function () {
        var url = player.getVideoUrl();
        var duration = player.getDuration();
        var code = player.getVideoEmbedCode();
        var sec = player.getCurrentTime();
        Debug.log("------getVideoUrl " + url);
        Debug.log("------getDuration " + duration);
        Debug.log("------getVideoEmbedCode " + code);
        var n = url.lastIndexOf('=');
        if (n == -1)
            return null;
        return { videoId: url.substr(n + 1), currentTime: sec };
    }


    this.crossFade = function (enable) {
        if (crossFade != enable) {
            crossFade = enable;
            if (player && playerSub && player.ready && playerSub.ready) {
                if (crossFade) {
                    timer = window.setTimeout(onTimeout, 1000);
                } else {
                    cancelFade();
                }
            }
        }
    }

    // デバッグ用
    this.debug = function () {
        //if (player.a.style.position == "absolute") {
        //    player.a.style.position = "static"
        //} else {
        //    player.a.style.position = "absolute"
        //}
        if (document.getElementById(player.id).style.position != "absolute") {
            document.getElementById(player.id).style.position = "absolute"
            document.getElementById(player.id).style.left = 0
        } else {
            document.getElementById(player.id).style.position = "static"
        }
    }
}
