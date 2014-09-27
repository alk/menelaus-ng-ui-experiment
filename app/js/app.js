'use strict';

angular.module('routerSpinner', ['ui.router'])
  .config(function ($provide, $compileProvider) {
    $provide.factory('rsViewsTracker', function ($rootScope) {
      var loadingViews = $rootScope.$rs$loadingViews = {};
      $rootScope.$rs$inTransition = false;
      var transition;
      return {
        noteViewLoading: function (name) {
          if ($rootScope.$rs$inTransition) {
            loadingViews[name] = true;
          } else {
            console.log("but not when transition is known to be on!");
            debugger
          }
        },
        registerTransition: function (promise) {
          console.log("state transition is starting");
          transition = promise;
          loadingViews = $rootScope.$rs$loadingViews = {};
          $rootScope.$rs$inTransition = true;
          promise['finally'](function onComplete() {
            if (promise !== transition) {
              return;
            }
            $rootScope.$rs$inTransition = false;
            console.log("state transition is complete");
          });
        }
      };
    });

    $provide.decorator('$state', function ($delegate, rsViewsTracker, $q) {
      $delegate.origTransitionTo = $delegate.transitionTo;
      $delegate.transitionTo = function (to, toParams, options) {
        var deferred = $q.defer();
        rsViewsTracker.registerTransition(deferred.promise);
        var promise = $delegate.origTransitionTo(to, toParams, options);
        promise['finally'](function () {
          deferred.resolve(true);
        });
        return promise;
      }
      return $delegate;
    });

    $provide.decorator('$view', function ($delegate, rsViewsTracker) {
      $delegate.origLoad = $delegate.load;
      $delegate.load = function (viewName, options) {
        console.log("view is being loaded!: ", viewName);
        rsViewsTracker.noteViewLoading(viewName);
        return $delegate.origLoad(viewName, options);
      };

      return $delegate;
    });

    $compileProvider.directive('uiView', function ($rootScope) {
      return {
        priority: 0,
        link: function (scope, element, attrs) {
          var name      = attrs.uiView || attrs.name || '',
          inherited = element.inheritedData('$uiView');
          var spinner;

          if (name.indexOf('@') < 0) {
            name = name + '@' + (inherited ? inherited.state.name : '');
          }

          console.log("linking ", name, element);

          function watchExpr() {
            return $rootScope.$rs$inTransition && $rootScope.$rs$loadingViews[name];
          }

          var imgText = '<div class="spinner"></div>';

          function drawSpinner(loading) {
            console.log("drawSpinner ", loading);
            if (loading) {
              spinner = angular.element(imgText);
              element.prepend(spinner);
              element.addClass("spinner-container");
            } else {
              if (spinner) {
                spinner.remove();
                element.removeClass("spinner-container");
              }
            }
          }

          var unreg = $rootScope.$watch(watchExpr, drawSpinner);

          var destroyed = false;

          function doDestroy() {
            if (destroyed) {
              return;
            }
            destroyed = true;
            console.log("$destroy ", name, element);
            unreg();
            unreg2();
            hidingPlace.empty();
          }

          element.on('$destroy', doDestroy);
          scope.$on('$destroy', doDestroy);

          var unreg2 = $rootScope.$on("dumpstuff", function () {
            console.log("uiView thing: ", name, element);
          });
        }
      };
    });
  });

angular.module('myAppDev', ['myApp', 'mnHooks', 'routerSpinner'])
  .run(function ($injector) {
    window.theInjector = $injector;
  })
  .config(function ($provide) {
    // $provide.decorator("$templateFactory", function ($delegate, $timeout, $q, $rootScope) {
    //   $delegate.mnOrigFromConfig = $delegate.fromConfig;
    //   $delegate.fromConfig = function () {
    //     console.log("started template loading: ", arguments);
    //     var rv = $delegate.mnOrigFromConfig.apply(this, arguments);
    //     $rootScope.$broadcast('$viewContentLoading');
    //     return $q.when(rv).then(function (value) {
    //       console.log("loaded template: ", value);
    //       return $timeout(function () {
    //         console.log("signalling loaded template: ", value);
    //         return value;
    //       }, 500);
    //     });
    //   }
    //   return $delegate;
    // });

    // $provide.decorator('$view', function ($delegate, $timeout, $q) {
    //   $delegate.origLoad = $delegate.load;
    //   $delegate.load = function (viewName, options) {
    //     console.log("view is being loaded!: ", viewName);
    //     return $delegate.origLoad(viewName, options);
    //   };

    //   return $delegate;
    // });
  });

angular.module('mnGet', []).factory("mnGet", function ($http, $q) {
  return function mnGet(path) {
    var timeoutD = $q.defer();
    var cancelled = false;
    var rv = $http.get(path, {timeout: timeoutD.promise}).then(function (props) {
      if (cancelled) {
        return $q.defer().promise;
      }
      return props.data;
    });
    rv.path = path;
    rv.cancel = function () {
      cancelled = true;
      timeoutD.resolve();
    }
    return rv;
  }
});

function longPollGet(getter, callback) {
  var rv = {
    currentValue: undefined
  };
  function startNextPromise() {
    getter(rv.currentValue).then(function (value) {
      rv.currentValue = value;
      startNextPromise();
      return value;
    }).then(callback);
  }
  startNextPromise();
  return rv;
}

function makePoolDetailsPoller($q, mnGet, callback) {
  var waitChanges = 20000;
  var smallerWaitChanges = 0;
  var rvD;
  var getPromise;
  var started = false;
  var etag;

  function getter(oldValue) {
    if (oldValue) {
      etag = oldValue.etag;
    }
    rvD = $q.defer();
    if (started) {
      sendReq();
    }
    return rvD.promise;
  }

  function sendReq() {
    var myRVD = rvD;
    var path = "/pools/default?waitChanges=" + waitChanges;
    if (etag) {
      path += "&etag=" + etag;
    }
    getPromise = mnGet(path);
    getPromise.then(function (value) {
      myRVD.resolve(value);
    });
  }

  var rv = longPollGet(getter, callback);

  rv.changeWaitChanges = function (newWaitChanges) {
    if (newWaitChanges === waitChanges) {
      return;
    }
    waitChanges = newWaitChanges;
    if (getPromise) {
      getPromise.cancel();
    }
    sendReq();
  }

  rv.start = function () {
    if (started) {
      return;
    }
    started = true;
    sendReq();
  }

  return rv;
}

function replaceObjectProps(dst, src) {
  _.each(_.keys(dst), function (k) {
    delete dst[k];
  });
  angular.copy(src, dst);
}

angular.module('mnGetBox', ['mnGet']).factory('makeGetBox', function makeGetBoxFactory($browser, mnGet) {
  return function makeGetBox(initialURL, callback) {
    var value;
    var needed = false;
    var url = initialURL;
    var getPromise;
    fetch();
    return {
      setURL: function (newURL) {
        if (newURL === url) {
          return;
        }
        url = newURL;
        fetch();
      },
      setNeeded: function (newNeeded, provisionalValue) {
        if (arguments.length > 1 && newNeeded) {
          throw new Error();
        }
        needed = newNeeded;
        if (needed) {
          fetch(url);
        } else {
          if (getPromise) {
            getPromise.cancel();
            getPromise = null;
          }
          value = provisionalValue;
          callback(value);
        }
      },
      refresh: function () {
        if (getPromise) {
          return;
        }
        fetch();
      },
      autoRefreshAfter: function (millis) {
        // TODO
      },
      getCurrentValue: function () {
        return value;
      }
    }

    function fetch() {
      if (url === undefined) {
        value = undefined;
        if (getPromise) {
          getPromise.cancel();
          getPromise = null;
        }
        callback(value);
        return;
      }
      if (getPromise) {
        if (getPromise.url === url) {
          return;
        }
        if (getPromise.cancel) {
          getPromise.cancel();
        }
      }
      getPromise = mnGet(url);
      getPromise.url = url;
      getPromise.then(function (newValue) {
        value = newValue;
        getPromise = null;
        callback(newValue);
      });
    }
  }
});

function CoreDataKeeper($q, $rootScope, mnGet, makeGetBox) {
  var self = this;
  self.mnGet = mnGet;
  self.$q = $q;
  self.scope = $rootScope.$new(true);

  self.serverGroupsBox = makeGetBox(undefined, function (serverGroups) {
    self.scope.serverGroups = serverGroups;
  });

  self.bucketsBox = makeGetBox(undefined, function (buckets) {
    self.scope.buckets = buckets;
  });

  self.tasksBox = makeGetBox(undefined, function (tasks) {
    self.scope.tasks = tasks;

    var initMinPeriod = 1 << 28;
    var minPeriod = initMinPeriod;
    _.each(tasks, function (taskInfo) {
      var period = taskInfo.recommendedRefreshPeriod;
      if (!period) {
        return;
      }
      period = (period * 1000) >> 0;
      if (period < minPeriod) {
        minPeriod = period;
      }
    });

    if (minPeriod < initMinPeriod) {
      self.tasksBox.autoRefreshAfter(minPeriod);
    }
  });

  self.pdPoller = makePoolDetailsPoller($q, mnGet, function (poolDetails) {
    self.scope.poolDetails = poolDetails;
  });
  self.scope.$watch("poolDetails", function (poolDetails) {
    if (!poolDetails) {
      return;
    }

    if (!poolDetails.serverGroupsUri) {
      self.serverGroupsBox.setNeeded(false, {groups: []});
    } else {
      self.serverGroupsBox.setURL(poolDetails.serverGroupsUri);
    }

    self.bucketsBox.setURL(poolDetails.buckets.uri);

    self.tasksBox.setURL(poolDetails.tasks.uri);
  });

  self.scope.$watch("[poolDetails, serverGroups]", function (arr) {
    var newServers = (function () {
      if (arr === undefined || arr[0] === undefined || arr[1] === undefined) {
        return {};
      }
      var poolDetails = arr[0];
      var serverGroups = arr[1];

      return {active: poolDetails.nodes,
              pending: poolDetails.nodes};
    })();
    if (_.isEqual(newServers, self.scope.servers)) {
      return;
    }
    self.scope.servers = newServers;
  }, true);

  "servers buckets tasks poolDetails".split(" ").forEach(function (name) {
    self[name] = {};
    self.scope.$watch(name, function (value) {
      if (angular.isArray(value)) {
        value = {list: value};
      }

      replaceObjectProps(self[name], value);
    });
  });

  self.bucketDetailsBoxes = {};
  self.scope.bucketDetails = {};

  self.resetWantedBucketDetails = function () {
    self.scope.bucketDetails = {};
    _.each(self.bucketDetailsBoxes, function (box) {
      box.setNeeded(false);
    });
    self.bucketDetailsBoxes = {};
  }

  self.setBucketDetailsNeeded = function (uri, needed) {
    if (!needed) {
      var box = self.bucketDetailsBoxes[uri];
      if (!box) {
        return;
      }
      box.setNeeded(false);
      delete self.bucketDetailsBoxes[uri];
      return
    }

    var box = self.bucketDetailsBoxes[uri];
    if (box) {
      return;
    }
    box = makeGetBox(undefined, function (info) {
      var obj = self.scope.bucketDetails[uri] || (self.scope.bucketDetails[uri] = {});
      replaceObjectProps(obj, info);
    });
    box.setURL(uri + "?basic_stats=true");
    self.bucketDetailsBoxes[uri] = box;
  }

  self.getBucketDetails = function (uri) {
    var obj = self.scope.bucketDetails[uri];
    if (!obj) {
      obj = self.scope.bucketDetails[uri] = {};
    }
    return obj;
  }

  self.refreshAllBuckets = function () {
    self.bucketsBox.refresh();
    _.each(self.bucketDetailsBoxes, function (box) {
      box.refresh();
    });
  }
}

_.extend(CoreDataKeeper.prototype, {
  isLoggedIn: function () {
    return true;
  },
  start: function () {
    this.pdPoller.start();
    this.start = function () {};
  },
  getServers: function () {
    return this.servers;
  },
  getBuckets: function () {
    return this.buckets;
  },
  getTasks: function () {
    return this.tasks;
  },
  getPoolDetails: function () {
    return this.poolDetails;
  },
  refreshPoolDetailsOften: function () {
  },
  cancelRefreshPoolDetailsOften: function () {
  }
});

// TODO: mn prefix for class ?
angular.module('mnCoreDataKeeper', ['mnGet', 'mnGetBox']).service('coreDataKeeper', CoreDataKeeper);


// Declare app level module which depends on filters, and services
angular.module('myApp', [
  'ui.router',
  'ui.bootstrap',
  'mnGet',
  'mnCoreDataKeeper',
  'myApp.filters',
  'myApp.services',
  'myApp.directives',
  'myApp.controllers'
]).config(function ($stateProvider, $urlRouterProvider, $provide) {
  var sp = $stateProvider;
  $urlRouterProvider.otherwise("/");

  sp.state("app", {
    abstract: true,
    url: "/",
    controller: function ($scope, coreDataKeeper) {
      coreDataKeeper.start();
      $scope.poolDetails = coreDataKeeper.getPoolDetails();
      $scope.buckets = coreDataKeeper.getBuckets();
      $scope.servers = coreDataKeeper.getServers();
    },
    template: "<ui-view></ui-view>"
  });

  sp.state("app.overview", {
    url: "",
    template: "{{poolDetails.etag}}<br><pre>servers count: {{poolDetails.nodes.length}}\n{{buckets.list.length}}</pre>"
  });

  sp.state("app.servers", {
    url: "servers",
    controller: function ($scope) {
      $scope.shownDetails = {}
      $scope.detailsOf = function (hostname) {
        if (!$scope.shownDetails[hostname]) {
          return;
        }
        return _.detect($scope.poolDetails.nodes, function (si) {return si.hostname === hostname;});
      }
      $scope.toggleDetails = function (hostname) {
        console.log("toggle: ", hostname);
        $scope.shownDetails[hostname] = !$scope.shownDetails[hostname];
      }
    },
    templateUrl: "partials/servers.html"
  });

  sp.state("app.buckets", {
    url: "buckets",
    resolve: {
      loadingR: function ($timeout) {
        console.log("buckets are loading. Self: ", this);
        return $timeout(angular.identity, 5000);
      }
    },
    controller: function ($scope, coreDataKeeper, makeGetBox) {
      var bucketDetailsBoxes = {};
      var bucketDetails = {};

      $scope.shownDetails = {};
      $scope.detailsOf = function (uri) {
        if (!bucketDetailsBoxes[uri]) {
          return;
        }

        var obj = bucketDetails[uri];
        if (!obj) {
          obj = bucketDetails[uri] = {};
        }
        return obj;
      }
      $scope.toggleDetails = function (uri) {
        console.log("toggle: ", uri);
        var box = bucketDetailsBoxes[uri];

        if (box) {
          box.setNeeded(false);
          delete bucketDetailsBoxes[uri];
          return;
        }

        box = makeGetBox(undefined, function (info) {
          var obj = bucketDetails[uri] || (bucketDetails[uri] = {});
          replaceObjectProps(obj, info);
        });
        box.setURL(uri + "&basic_stats=true");
        bucketDetailsBoxes[uri] = box;
      }
    },
    templateUrl: "partials/buckets.html"
  });
});
