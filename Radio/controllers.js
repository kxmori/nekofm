'use strict';

/* Controllers */

MainCtrl.$inject = ['$scope', '$rootScope', '$location', 'Radio', 'Brand'];
SearchResultCtrl.$inject = ['$scope', 'Radio', 'results'];
PlayerCtrl.$inject = ['$scope', '$location', 'Radio'];
StationListCtrl.$inject = ['$scope', '$location', 'Radio'];
ArtistDetailCtrl.$inject = ['$scope', 'Radio', 'artist'];
ArtistTracksCtrl.$inject = ['$scope', 'Radio', 'artist'];
ConfigCtrl.$inject = ['$scope', '$timeout', 'Radio', 'station'];
SongHistoryCtrl.$inject = ['$scope', 'Radio', 'history'];
FavoriteListCtrl.$inject = ['$scope', 'Radio', 'favorites'];
DonotListCtrl.$inject = ['$scope', 'Radio', 'donots'];

function MainCtrl($scope, $rootScope, $location, Radio, Brand) {
    $rootScope.$on("$routeChangeStart", function (event, next, current) {
        $scope.loading = true;
        Debug.log("Start " + $location.path());
    });
    $rootScope.$on("$routeChangeSuccess", function (event, current, previous) {
        $scope.loading = false;
        $scope.newLocation = $location.path();
        Debug.log("Success " + $location.path());

        // リロードされた時に検索窓が空にならないようにする
        if ($location.path() == "/radio/search") {
            Debug.log("けんさく文字列: [" + $scope.query + "]");
            //if ($scope.query == null) {
                var params = $location.search();
                $scope.query = "?" + params.q;
            //}
        }
    });
    $rootScope.$on("$routeChangeError", function (event, current, previous, rejection) {
        $scope.loading = false;
        Debug.log("Error " + $location.path());
        if ($location.path() == "/radio")
            $location.path("/radio/list");
    });
    $rootScope.$on("serviceCallStart", function () {
        $scope.loading = true;
    });
    $rootScope.$on("serviceCallEnd", function () {
        $scope.loading = false;
    });
    $rootScope.$on('MusicChanged', function (evt, arg) {
        $rootScope.title = arg.title + " - " + arg.artist; // html title
    })
    $scope.$on('StationListChanged', function (evt, arg) {
        if ($location.path() != "/radio/list")
            $location.path("/radio/list");
        $scope.station = Radio.station();
    })
    $scope.$on('StationChanged', function (evt, arg) {
        $scope.station = Radio.station();
    })

    $scope.brand = Brand;
    $scope.Math = window.Math;
    $scope.station = Radio.station();
    $scope.playContext = Radio.playContext();
    $scope.trackSearch = false;
    $scope.dt = new Date();

    $scope.doSearch = function (arg) {
        if (arg && $scope.trackSearch)  // arg がある場合、新規作成と判断する
            $scope.trackSearch = false;
        var query = arg || $scope.query;
        if ($scope.trackSearch || query.charAt(0) == '?' || query.charAt(0) == '？') {
            query = query.replace(/^[?？]*/g, "");   // 行頭の?を削除
            if (query.length > 0)
                $location.path("/radio/search").search({ q: query, p: 1 });
        } else {
            if (query.length > 0) {
                Radio.create(query);
                //$location.path("/radio/list");
            }
        }
    }

    $scope.toggleSearch = function () {
        $scope.trackSearch = !$scope.trackSearch;
        if ($scope.query) {
            $scope.query = $scope.query.replace(/^[?？]*/g, "");   // 行頭の?を削除
            if ($scope.trackSearch && $scope.query.length > 0)
                $scope.query = '?' + $scope.query;
        }
    }
    $scope.placeHolder = function () {
        return $scope.trackSearch ? 'Search For Music' : 'Create a New Station';
    }
    $scope.focusCreate = function () {
        $scope.trackSearch = false;
        $scope.query = "";
        $(".search-query").focus();
    }

    $scope.debug = function () {
        Radio.debug();
    }
    $scope.setBusy = function () {
        $scope.loading = true;
    }
    $scope.clearBusy = function () {
        $scope.loading = false;
    }
    $scope.checkWelcome = function () {
        return $scope.newLocation == "/radio" ? 'wide' : '';
    }
    $scope.checkUnknown = function (entry) {
        if (!entry)
            return false;
        return entry.artist == "_" ? true : false;
    }
    $scope.stationName = function () {
        return $scope.station ? $scope.station.name : "";
    }
}

function SearchResultCtrl($scope, Radio, results) {
    Debug.log("けんさくけっかーーーーーーーーーーーーーーー");

    Debug.dir(results);

    $scope.results = results;

    $scope.checkNext = function () {
        return $scope.results.page < parseInt(($scope.results.totalResults - 1) / 30) + 1;
    }

    $scope.play = function (index) {
        var track = $scope.results.tracks[index];
        Radio.playNow(track.artist, track.title);
    }
}

function PlayerCtrl($scope, $location, Radio) {
    Debug.log("ぷれーやーーーーーーーーーーーーーーーー");

    $scope.settings = Radio.playerSettings();

    $scope.toggleFade = function () {
        $scope.settings.crossFade = !$scope.settings.crossFade;
        if ($scope.settings.crossFade && $scope.settings.repeat) {
            $scope.settings.repeat = false;
        }
        Radio.playerSettings($scope.settings);
    }
    $scope.toggleRepeat = function () {
        if (!$scope.settings.crossFade) {
            $scope.settings.repeat = !$scope.settings.repeat;
            Radio.playerSettings($scope.settings);
        }
    }
    $scope.show = true;
    $scope.toggleShow = function () {
        $scope.show = !$scope.show;
    }
    $scope.eyeIcon = function () {
        return $scope.show ? "icon-eye-close" : "icon-eye-open";
    }
    $scope.eyeTitle = function () {
        return $scope.show ? "Hide YouTube Player" : "Show YouTube Player";
    }

    $scope.checkReady = function () {
        return $scope.playContext.playerState && $scope.playContext.playerState != -1;
    }

    $scope.doPause = function () {
        Radio.pause();
    }

    $scope.doNext = function () {
        Radio.doNext();
    }

    $scope.addFavorite = function () {
        Radio.addFavorite();
        $location.path("/radio/favorite");
    }

    $scope.addDonot = function () {
        Radio.addDonot();
        Radio.doNext();
    }


    $scope.editing = false;
    $scope.$on('MusicChanged', function (evt, arg) {
        $scope.editing = false;
    })

    $scope.startEditing = function () {
        if ($scope.editing) {
            $scope.editing = false;
            return;
        }
        var video = Radio.getVideoId();
        if (video) {
            $scope.videoId = video.id;
            $scope.stSec = video.stSec;
        } else {
            $scope.videoId = null;
            $scope.stSec = null;
        }
        $scope.errorMessage = "";
        $scope.editing = true;
    }

    $scope.doAdjust = function () {
        if ($scope.videoId != null) {

            if ($scope.videoId.length == 0) {
                Radio.setVideoId(null, $scope.videoId, $scope.stSec);
                $scope.editing = false;
                return;
            }

            // 現在再生中の動画IDと同じなら存在チェックは行わない
            var info = Radio.getPlaybackStatus();
            if (info.videoId == videoId) {
                Radio.setVideoId(null, $scope.videoId, $scope.stSec);
                $scope.editing = false;
                return;
            }

            // 最初に動画の存在チェックを行う
            var videoId = $scope.videoId.replace(/(^\s+)|(\s+$)/g, "");
            Radio.getVideoTitle(videoId, function (videoTitle) {
                Radio.setVideoId(null, videoId, $scope.stSec);
                $scope.$apply($scope.onLostFocus);
            }, function (errmsg) {
                $scope.$apply(function () {
                    $scope.errorMessage = errmsg;
                })
            });
        }
    }
    $scope.onLostFocus = function () {
        $scope.editing = false;
    }
    $scope.onSetStartSec = function () {
        var info = Radio.getPlaybackStatus();
        if (info) {
            $scope.stSec = info.currentTime;
            $scope.videoId = info.videoId;
        }
    }
    $scope.onResetStartSec = function () {
        $scope.stSec = null;
    }
    $scope.changed = function () {
        $scope.errorMessage = "";
    }
    $scope.dontPlay = function () {
        Radio.addDonotById();
        Radio.doNext();
        $scope.editing = false;
    }
}

function StationListCtrl($scope, $location, Radio) {

    function init(id) {
        Debug.log("すてーしょんりすとーーーーーーーーーーーーーーー");

        $scope.stationList = angular.copy(Radio.stationList());

        Debug.log("stationListの長さ" + Object.keys($scope.stationList).length);
        if (Object.keys($scope.stationList).length == 0)
            $location.path("/radio");    // welcome.html

        for (var key in $scope.stationList) {
            if (id != null && id == key) {
                $scope.stationList[key].editing = true;
                Debug.log("StationList 編集 : " + key);
            } else {
                $scope.stationList[key].editing = false;
            }
        }
    }

    init();

    $scope.$on('StationListChanged', function (evt, arg) {
        init(arg);
    })

    $scope.startEditing = function (key) {
        $scope.stationList[key].editing = true;
    }
    $scope.doRename = function (key) {
        var newName = $scope.stationList[key].name.replace(/(^\s+)|(\s+$)/g, "");
        if (newName.length > 0) {
            Radio.renameStation(key, newName);
        } else {
            $scope.stationList[key].name = angular.copy(Radio.stationList()[key].name);
        }
        $scope.stationList[key].editing = false;
    }
    $scope.onLostFocus = function (key) {
        $scope.stationList[key].name = angular.copy(Radio.stationList()[key].name);
        $scope.stationList[key].editing = false;
    };

    $scope.changeStation = function (key) {
        if ($scope.stationList[key].name == $scope.stationName())
            $location.path("radio/config");
        else
            Radio.changeStation(key);
    }

    $scope.removeStation = function (key) {
        if (window.confirm("Are you sure you want to remove the following station?\n\n" + $scope.stationList[key].name))
            Radio.removeStation(key);
    }

    $scope.newStation = function () {
        $scope.focusCreate();
    }
}

function ArtistDetailCtrl($scope, Radio, artist) {
    Debug.log("あーてぃすとしょうさいーーーーーーーーーーーーーーー");

    $scope.artist = artist;

    $scope.play = function (index) {
        Radio.playNow($scope.artist.name, $scope.artist.songs[index].name);
    }

    $scope.$on("artistSongsUpdate", function (evt, arg) {
        $scope.clearBusy();
    });
    $scope.getMoreSongs = function () {
        $scope.setBusy();
        Radio.getTracks($scope.artist);
    }

    $scope.setSongCount = function (index) {
        Radio.setSongCount($scope.artist, index + 1);
    }
    $scope.getSongCount = function (index) {
        return Radio.getSongCount($scope.artist);
    }
}

function ArtistTracksCtrl($scope, Radio, artist) {
    Debug.log("あーてぃすと　とらっくーーーーーーーーーーーーーーー");

    $scope.artist = artist;

    $scope.play = function (index) {
        Radio.playNow($scope.artist.name, $scope.artist.songs[index].name);
    }

    $scope.$on("artistSongsUpdate", function (evt, arg) {
        $scope.clearBusy();
    });
    $scope.getMoreSongs = function () {
        $scope.setBusy();
        Radio.getTracks($scope.artist);
    }
}

function ConfigCtrl($scope, $timeout, Radio, station) {
    Debug.log("こんふぃぐーーーーーーーーーーーーーーー");

    $scope.artists = station.artists;

    $scope.addArtist = function () {
        Radio.addArtist($scope.newArtist, 10);
    }

    $scope.removeArtist = function (index) {
        Radio.removeArtist(index, 1);
    }

    // update delayed
    $scope.dirty = false;
    $scope.changed = function (index) {
        if (!$scope.dirty) {
            $scope.dirty = true;
            $timeout(function () {
                Radio.doSaveStation();
                $scope.dirty = false;
            }, 3000);
        }
    }
    $scope.thumbsUp = function (index) {
        if ($scope.artists[index].match < 10) {
            $scope.artists[index].match++;
            $scope.changed();
        }
    }
    $scope.thumbsDown = function (index) {
        if ($scope.artists[index].match > 0) {
            $scope.artists[index].match--;
            $scope.changed();
        }
    }

    $scope.artists.forEach(function (artist) {
        artist.editing = false;
    });

    $scope.startEditing = function (index) {
        $scope.artists[index].editing = true;
    }
    $scope.doAdjust = function (index) {
        $scope.artists[index].editing = false;
    }
    $scope.onLostFocus = function (index) {
        $scope.artists[index].editing = false;
    };
}

function SongHistoryCtrl($scope, Radio, history) {
    Debug.log("ひすとりーーーーーーーーーーーーーーー");

    $scope.history = history;

    $scope.play = function (index) {
        var track = $scope.history[index];
        Radio.playNow(track.artist, track.title);
    }
}

function FavoriteListCtrl($scope, Radio, favorites) {
    Debug.log("おきにいりーーーーーーーーーーーーーーー");

    $scope.favorites = favorites;

    $scope.playIcon = function (entry) {
        if ($scope.station) {
            var id = Radio.getStationId().id;
            if (entry.tags.indexOf(id) != -1)
                return "img/Music-Green.png";
            else
                return "img/Music-Grey.png";
        }
    }
    $scope.togglePlay = function (entry) {
        if ($scope.station) {
            var id = Radio.getStationId().id;
            if (entry.tags.indexOf(id) != -1)
                Radio.removeFavorite(entry);
            else
                Radio.addFavorite(entry);
        }
    }
    //$scope.tooltip = function (entry) {
    //    if ($scope.station) {
    //        var id = Radio.getStationId().id;
    //        if (entry.tags.indexOf(id) != -1)
    //            return "exclude from station";
    //        else
    //            return "include in station";
    //    }
    //}
    $scope.checkStation = function () {
        return $scope.station ? true : false;
    }


    //$scope.play = function (index) {
    //    var track = $scope.favorites[index];
    $scope.play = function (entry) {
        Radio.playNow(entry.artist, entry.title);
    }

    //$scope.remove = function (index) {
    //    Radio.removeFavorite(index);
    $scope.remove = function (entry) {
        Radio.removeFavorite(entry, true);
    }

    $scope.playAll = function () {
        Radio.playFavorites();
    }

    $scope.editing = false;

    $scope.startEditing = function () {
        if ($scope.editing) {
            $scope.editing = false;
            return;
        }
        $scope.videoId = "";
        $scope.track = { artist: "", title: "" };
        $scope.errorMessage = "";
        $scope.editing = true;
    }
    $scope.add = function () {
        Radio.addFavoriteAs($scope.videoId, $scope.track,
            function () {
                $scope.$apply($scope.onLostFocus);
            },
            function (errmsg) {
                $scope.$apply(function () {
                    $scope.errorMessage = errmsg;
                    //$scope.videoId.$setValidity("not-found", true);
                })
            });
    }
    $scope.onLostFocus = function () {
        $scope.editing = false;
    }
    $scope.changed = function () {
        $scope.errorMessage = "";
    }
}

function DonotListCtrl($scope, Radio, donots) {
    Debug.log("再生しないでーーーーーーーーーーーーーーー");

    $scope.donots = donots;

    $scope.play = function (entry) {
        Radio.playNow(entry.artist, entry.title);
    }

    $scope.remove = function (entry) {
        Radio.removeDonot(entry);
    }
}
