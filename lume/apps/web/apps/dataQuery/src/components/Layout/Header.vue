<script setup lang="ts">
  import Logo from './Logo.vue';
  import Profile from './Profile.vue';
</script>

<template>
  <div class="header">
    <div class="header-main">
      <div class="left-section">
        <Logo />

        <div class="header-menu">
          <div class="header-menu__item header-menu__item--active">运营信息</div>
          <div class="header-menu__item">合规检查</div>
        </div>
      </div>

      

      <div class="right-section">
        <div class="flex items-center gap-6">
          <Profile />
        </div>

        
      </div>
    </div>
  </div>
</template>

<style>
@keyframes headerBg {
  0% {
		background-position: 0% 50%;
	}
	50% {
		background-position: 100% 50%;
	}
	100% {
		background-position: 0% 50%;
	}
}
</style>

<style scoped lang="less">
  .header {
    position: fixed;
    width: 100%;
    height: 350px;
    background: #2d3e67;
    // background: linear-gradient(80deg,#2d3e67 20%,#D1E0FF,#2d3e67);

    // background: linear-gradient(80deg, #2d3e67 20%, #D1E0FF, #2d3e67);
	  // background-size: 400% 400%;

    // animation: headerBg 40s linear infinite;
  }

  

  .header-main {
    display: flex;
    align-items: center;
    justify-content: space-between;

    height: 74px;
    margin: 0 auto;
    padding: 0 24px;

    @media (min-width: 1920px) {
      max-width: 1968px;
    }
  }

  .left-section {
    display: flex;
    align-items: center;

    .title {
      display: flex;
      align-items: center;
      font-size: 16px;

      color: #fff;
      font-weight: 500;
      border-radius: 6px;
      padding: 7px 12px;
      margin-left: 30px;

      background: #11285d;
      box-shadow: inset 0px 5px 10px 0px rgba(0, 0, 0, 0.5);
    }
  }

  .right-section {
    display: flex;
    align-items: center;
    color: #fff;
  }

  .header-menu {
    display: flex;
    align-items: center;
    height: 30px;
    margin-left: 8px;

    font-size: 14px;
    font-weight: 500;
    color: #fff;
  }

  .header-menu__item {
    padding: 0 12px;
    height: 30px;
    line-height: 30px;
    cursor: pointer;
    border-radius: 8px;

    &:hover {
      color: #e1eaff;
    }

    &--active {
      color: #1c4096!important;
      background: #f5f5fe;
    }
  }
</style>
