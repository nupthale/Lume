<script setup lang="ts">
  import { RouterLink } from 'vue-router';

  import Logo from './Logo.vue';
  import Icon from '@/components/Icon/index.vue';
  import { useMenus } from './useMenus';

  import { isYiban } from '@/utils/yiban';
  import Profile from './Profile.vue';

  const menuIcons = {
    'products': 'number-00_outlined',
    'products-rate': 'number-00_outlined',
    'products-group': 'template_outlined',
    'products-account': 'table-group_outlined',
    'receipts': 'link-record_outlined',
    'reconciliation': 'computer_outlined',
  };

  const { menus } = useMenus(menuIcons);  
</script>

<template>
  <div class="sider">
    <div>
      <Logo />

      <div class="menus">
        <template v-for="menu in menus">
          <div v-if="menu.children?.length" class="menu-group">
            <div class="menu-groupTitle" >{{ menu.title }}</div>
            <RouterLink
              v-for="item in menu.children"
              :key="item.key"
              :to="item.path" 
              activeClass="menu--active" 
              class="menu menu_sub">
                <Icon class="mr-3.5" :icon="menuIcons[item.key]" size="18px" />
                {{ item.title }}
            </RouterLink>
          </div>
          

          <RouterLink
            v-else
            :key="menu.key"
            :to="menu.path" 
            activeClass="menu--active" 
            class="menu">
              <Icon class="mr-3.5" :icon="menuIcons[menu.key]" size="18px" />
              {{ menu.title }}
          </RouterLink>
        </template>
      </div>
    </div>

    <div class="profile" v-if="!isYiban">
      <Profile />
      <div></div>
    </div>
  </div>
</template>

<style scoped lang="less">
.sider {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  width: 290px;
  height: 100%;

  @media screen and (max-width: 1800px)  {
    width: 210px;
  }
}

.menus {
  padding-left: 30px;
  margin-top: 45px;
  font-size: 14px;

  @media screen and (max-width: 1800px)  {
    padding-left: 10px;
  }

  .menu-group {
    padding: 8px;
    margin-bottom: 10px;
  }

  .menu-groupTitle {
    font-size: 12px;
    font-weight: 500;
    color: #646a73;
    padding: 8px 0;
  }

  .menu {
    width: 184px;
    display: flex;
    align-items: center;
    height: 32px;
    line-height: 32px;
    margin-bottom: 10px;
    padding: 8px;
    border-radius: 8px;
    cursor: pointer;

    @media screen and (max-width:1800px) {
      width: 160px;
    }

    &:last-of-type {
      margin-bottom: 0;
    }

    &_sub {
      margin-left: 16px;

      @media screen and (max-width:1800px) {
        margin-left: 6px;
      }
    }

    &--active {
      font-weight: 500;
      color: #fff;
      background: #3370FF;
    }

    &:not(&--active):hover {
      font-weight: 500;
      color: #3370FF; 
    }
  }
}

.profile {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 184px;
  height: 62px;
  line-height: 32px;
  border-radius: 8px;
  margin: 0 0 20px 30px;

  @media screen and (max-width: 1800px)  {
    margin-left: 10px;
  }

  border: 1px solid #eee;
  background: radial-gradient(178.94% 106.41% at 26.42% 106.41%, #ecedf1 0%, rgba(255, 255, 255, 0) 71.88%), transparent;
}
</style>

<style scoped>
.profile :deep(.zsui-user__avatar) {
  border-radius: 6px;
  width: 26px!important;
  height: 26px!important;
  line-height: 26px!important;
}

.profile :deep(.ant-btn-text) {
  display: flex;
  flex: 1;
  overflow: hidden;
  padding: 6px;
  margin: 4px;
}
</style>