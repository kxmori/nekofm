'use strict';

/* App Module */

angular.module('myRadio', ['radioServices']).
    constant('Brand', 'Neko.fm').
    config(['$routeProvider', function ($routeProvider) {
        $routeProvider.
        when('/radio', {
            templateUrl: 'partials/welcome.html',
            resolve: {
                url: ['$q', 'Radio', function ($q, Radio) {
                    var deferred = $q.defer();
                    if (!Radio.isEmpty())
                        deferred.reject('/radio/list');
                    else
                        deferred.resolve('/radio');
                    return deferred.promise;
                }]
            }
        }).
        when('/radio/search', {
            templateUrl: 'partials/search-result.html',
            controller: SearchResultCtrl,
            resolve: {
                results: ['$q', '$location', 'Radio', function ($q, $location, Radio) {
                    var deferred = $q.defer();

                    var params = $location.search();

                    Radio.search(params.q, parseInt(params.p), function (results) {
                        deferred.resolve(results);
                    }, function () {
                        deferred.reject("Server error");
                    });

                    return deferred.promise;
                }]
            }
        }).
        when('/radio/artist/:name', {
            templateUrl: 'partials/artist-tracks.html',
            controller: ArtistTracksCtrl,
            resolve: {
                artist: ['$q', '$route', 'Radio', function ($q, $route, Radio) {
                    var deferred = $q.defer();

                    var name = $route.current.params.name;

                    Radio.getArtistProfile(name, function (artist) {
                        deferred.resolve(artist);
                    }, function () {
                        deferred.reject("Server error");
                    });

                    return deferred.promise;
                }]
            }
        }).
        when('/radio/config', {
            templateUrl: 'partials/config.html',
            controller: ConfigCtrl,
            resolve: {
                station: ['$q', 'Radio', function ($q, Radio) {
                    var deferred = $q.defer();
                    var station = Radio.station();
                    if (station)
                        deferred.resolve(station);
                    else
                        deferred.reject("station not yet open");
                    return deferred.promise;
                }]
            }
        }).
        when('/radio/config/:artistId', {
            templateUrl: 'partials/artist-detail.html',
            controller: ArtistDetailCtrl,
            resolve: {
                artist: ['$q', '$route', 'Radio', function ($q, $route, Radio) {
                    var deferred = $q.defer();
                    var artist = Radio.getArtistDetail($route.current.params.artistId);
                    if (artist)
                        deferred.resolve(artist);
                    else
                        deferred.reject("illegal index");
                    return deferred.promise;
                }]
            }
        }).
        when('/radio/list', { templateUrl: 'partials/station-list.html', controller: StationListCtrl }).
        //when('/radio/welcome', { templateUrl: 'partials/welcome.html' }).
        when('/radio/history', {
            templateUrl: 'partials/song-history.html',
            controller: SongHistoryCtrl,
            resolve: {
                history: ['$q', 'Radio', function ($q, Radio) {
                    var deferred = $q.defer();
                    var history = Radio.history();
                    if (history.length == 0 && Radio.isEmpty())
                        deferred.reject("history is empty");
                    else
                        deferred.resolve(history);
                    return deferred.promise;
                }]
            }
        }).
        when('/radio/favorite', {
            templateUrl: 'partials/favorite-list.html',
            controller: FavoriteListCtrl,
            resolve: {
                favorites: ['$q', 'Radio', function ($q, Radio) {
                    var deferred = $q.defer();
                    var favorites = Radio.favorites();
                    if (favorites.length == 0 && Radio.isEmpty())
                        deferred.reject("favorites is empty");
                    else
                        deferred.resolve(favorites);
                    return deferred.promise;
                }]
            }
        }).
        when('/radio/donot', {
            templateUrl: 'partials/donot-list.html',
            controller: DonotListCtrl,
            resolve: {
                donots: ['$q', 'Radio', function ($q, Radio) {
                    var deferred = $q.defer();
                    var donots = Radio.donots();
                    if (donots.length == 0 && Radio.isEmpty())
                        deferred.reject("donots is empty");
                    else
                        deferred.resolve(donots);
                    return deferred.promise;
                }]
            }
        }).
        otherwise({ redirectTo: '/radio' });
    }]);
